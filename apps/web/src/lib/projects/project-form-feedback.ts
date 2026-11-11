import { ApiError, NetworkError } from "../api/problem.ts";

export type ProjectFieldName = "title" | "format" | "logline";

/** What the create form shows after something went wrong: messages under fields, and general ones. */
export interface ProjectFormFeedback {
  readonly fieldErrors: Readonly<Partial<Record<ProjectFieldName, string>>>;
  readonly general: readonly string[];
}

export interface ProjectSummaryEntry {
  readonly message: string;
  readonly fieldId?: string;
}

const FIELD_ORDER: readonly ProjectFieldName[] = ["title", "format", "logline"];

// The API names a field by a JSON pointer. Only these three are ever turned into a field; a Map
// (not an object) so that a pointer such as "/__proto__" can never reach a built-in property.
const POINTER_TO_FIELD: ReadonlyMap<string, ProjectFieldName> = new Map([
  ["/title", "title"],
  ["/format", "format"],
  ["/logline", "logline"],
]);

const GENERIC = "Something went wrong. Please try again.";
const NO_CONNECTION = "Can't reach the server. Check your connection and try again.";

function onlyGeneral(...messages: string[]): ProjectFormFeedback {
  return { fieldErrors: {}, general: messages };
}

function describeIssues(error: ApiError): ProjectFormFeedback {
  const fieldErrors: Partial<Record<ProjectFieldName, string>> = {};
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

function describeTooManyRequests(seconds: number | undefined): string {
  if (seconds === undefined) return "Too many requests. Please wait a moment and try again.";
  return `Too many requests. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
}

/**
 * Turns what went wrong while creating a project into words for a person. Only text written for
 * people is ever shown: the messages the API gives for each field, and the fixed sentences below.
 * The technical `detail` of an error is never shown, and neither is the text of an unknown error.
 */
export function describeProjectError(error: unknown): ProjectFormFeedback {
  if (error instanceof NetworkError) return onlyGeneral(NO_CONNECTION);
  if (!(error instanceof ApiError)) return onlyGeneral(GENERIC);

  switch (error.status) {
    case 400:
      return describeIssues(error);
    case 401:
      return onlyGeneral("Your login has ended. Please log in again.");
    case 429:
      return onlyGeneral(describeTooManyRequests(error.retryAfterSeconds));
    case 503:
      return onlyGeneral("The service is busy. Try again in a moment.");
    default:
      return onlyGeneral(GENERIC);
  }
}

/**
 * The words for a list that could not be loaded. One sentence, no field messages: nothing the
 * person typed is involved.
 */
export function describeListError(error: unknown): string {
  if (error instanceof NetworkError) return NO_CONNECTION;
  if (error instanceof ApiError) {
    if (error.status === 429) return describeTooManyRequests(error.retryAfterSeconds);
    if (error.status === 503) return "The service is busy. Try again in a moment.";
  }
  return "Your projects could not be loaded. Please try again.";
}

/**
 * The only check the page does itself: the title must not be empty and a format must be chosen.
 * Everything else (how long a title may be) is the API's rule, so there is one rulebook, not two.
 */
export function validateRequired(values: {
  readonly title: string;
  readonly format: string;
}): ProjectFormFeedback | undefined {
  const fieldErrors: Partial<Record<ProjectFieldName, string>> = {};
  if (values.title.trim() === "") fieldErrors.title = "Enter a title.";
  if (values.format === "") fieldErrors.format = "Choose a format.";
  return Object.keys(fieldErrors).length === 0 ? undefined : { fieldErrors, general: [] };
}

/** The list for the error summary: field problems in form order, each linked, then general ones. */
export function summaryItems(
  feedback: ProjectFormFeedback,
  fieldIds: Readonly<Record<ProjectFieldName, string>>,
): ProjectSummaryEntry[] {
  const items: ProjectSummaryEntry[] = [];
  for (const field of FIELD_ORDER) {
    const message = feedback.fieldErrors[field];
    if (message !== undefined) items.push({ message, fieldId: fieldIds[field] });
  }
  for (const message of feedback.general) items.push({ message });
  return items;
}
