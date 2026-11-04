import { ApiError, NetworkError } from "../api/problem.ts";

export type AuthFieldName = "email" | "password" | "displayName";
export type AuthForm = "login" | "register";

/** What a form shows after something went wrong: messages under fields, and general ones. */
export interface FormFeedback {
  readonly fieldErrors: Readonly<Partial<Record<AuthFieldName, string>>>;
  readonly general: readonly string[];
}

export interface SummaryEntry {
  readonly message: string;
  readonly fieldId?: string;
}

const FIELD_ORDER: readonly AuthFieldName[] = ["email", "password", "displayName"];

// The API names a field by a JSON pointer. Only these three are ever turned into a field; a Map
// (not an object) so that a pointer such as "/__proto__" can never reach a built-in property.
const POINTER_TO_FIELD: ReadonlyMap<string, AuthFieldName> = new Map([
  ["/email", "email"],
  ["/password", "password"],
  ["/displayName", "displayName"],
]);

const GENERIC = "Something went wrong. Please try again.";

function onlyGeneral(...messages: string[]): FormFeedback {
  return { fieldErrors: {}, general: messages };
}

function describeIssues(error: ApiError): FormFeedback {
  const fieldErrors: Partial<Record<AuthFieldName, string>> = {};
  const general: string[] = [];
  for (const issue of error.issues) {
    const field = POINTER_TO_FIELD.get(issue.pointer);
    if (field === undefined) {
      general.push(issue.message);
    } else if (fieldErrors[field] === undefined) {
      fieldErrors[field] = issue.message;
    }
  }
  if (error.issues.length === 0) general.push("Please check what you entered and try again.");
  return { fieldErrors, general };
}

function describeTooManyAttempts(seconds: number | undefined): string {
  if (seconds === undefined) return "Too many attempts. Please wait a moment and try again.";
  return `Too many attempts. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
}

/**
 * Turns what went wrong into words for a person. Only text written for people is ever shown:
 * the messages the API gives for each field, and the fixed sentences below. The technical
 * `detail` of an error is never shown, and neither is the text of an unknown error.
 *
 * A wrong login is one message whatever the cause, so it never tells whether an email exists.
 * (A sign-up that finds the email taken does say so; the API accepts that trade-off.)
 */
export function describeAuthError(error: unknown, form: AuthForm): FormFeedback {
  if (error instanceof NetworkError) {
    return onlyGeneral("Can't reach the server. Check your connection and try again.");
  }
  if (!(error instanceof ApiError)) return onlyGeneral(GENERIC);

  switch (error.status) {
    case 400:
      return describeIssues(error);
    case 401:
      return form === "login"
        ? onlyGeneral("Email or password is incorrect.")
        : onlyGeneral(GENERIC);
    case 409:
      return form === "register"
        ? { fieldErrors: { email: "That email is already registered." }, general: [] }
        : onlyGeneral(GENERIC);
    case 429:
      return onlyGeneral(describeTooManyAttempts(error.retryAfterSeconds));
    case 503:
      return onlyGeneral("The service is busy. Try again in a moment.");
    default:
      return onlyGeneral(GENERIC);
  }
}

/**
 * The only check the page does itself: a field must not be empty. Everything else (is it an
 * email, is the password long enough) is the API's rule, so there is one rulebook, not two.
 *
 * The page never modifies a password (no trimming): what was typed is what is sent, and the API
 * normalises it. So a password of only spaces counts as filled in here, and the API's policy then
 * refuses it with "Use more than spaces." The email is different: spaces around it are never part
 * of it, so only its emptiness check ignores them (the forms also trim it before sending).
 */
export function validateRequired(
  values: { readonly email: string; readonly password: string },
  form: AuthForm,
): FormFeedback | undefined {
  const fieldErrors: Partial<Record<AuthFieldName, string>> = {};
  if (values.email.trim() === "") fieldErrors.email = "Enter your email address.";
  if (values.password === "") {
    fieldErrors.password = form === "login" ? "Enter your password." : "Enter a password.";
  }
  return Object.keys(fieldErrors).length === 0 ? undefined : { fieldErrors, general: [] };
}

/** The list for the error summary: field problems in form order, each linked, then general ones. */
export function summaryItems(
  feedback: FormFeedback,
  fieldIds: Readonly<Record<AuthFieldName, string>>,
): SummaryEntry[] {
  const items: SummaryEntry[] = [];
  for (const field of FIELD_ORDER) {
    const message = feedback.fieldErrors[field];
    if (message !== undefined) items.push({ message, fieldId: fieldIds[field] });
  }
  for (const message of feedback.general) items.push({ message });
  return items;
}
