import { describe, expect, it } from "vitest";
import { ApiError, NetworkError, ResponseShapeError } from "../../api/problem.ts";
import {
  describeAuthError,
  type FormFeedback,
  summaryItems,
  validateRequired,
} from "../form-feedback.ts";

function apiError(
  status: number,
  extra: Partial<{
    code: string;
    detail: string;
    issues: { pointer: string; message: string }[];
    retryAfterSeconds: number;
  }> = {},
): ApiError {
  return new ApiError({
    status,
    code: extra.code,
    detail: extra.detail,
    issues: extra.issues ?? [],
    retryAfterSeconds: extra.retryAfterSeconds,
  });
}

const GENERIC = "Something went wrong. Please try again.";

describe("describeAuthError", () => {
  describe("400: the server explains what is wrong with each field", () => {
    it("puts each message under its own field", () => {
      const feedback = describeAuthError(
        apiError(400, {
          issues: [
            { pointer: "/email", message: "Enter a valid email address." },
            { pointer: "/password", message: "Use at least 12 characters." },
            { pointer: "/displayName", message: "Use at most 80 characters." },
          ],
        }),
        "register",
      );
      expect(feedback.fieldErrors).toEqual({
        email: "Enter a valid email address.",
        password: "Use at least 12 characters.",
        displayName: "Use at most 80 characters.",
      });
      expect(feedback.general).toEqual([]);
    });

    it("shows only the first message of a field", () => {
      const feedback = describeAuthError(
        apiError(400, {
          issues: [
            { pointer: "/password", message: "First problem." },
            { pointer: "/password", message: "Second problem." },
          ],
        }),
        "register",
      );
      expect(feedback.fieldErrors).toEqual({ password: "First problem." });
    });

    it("shows a message for an unknown field as a general problem, never as a field", () => {
      const feedback = describeAuthError(
        apiError(400, {
          issues: [
            { pointer: "/something-else", message: "Strange problem." },
            { pointer: "/email", message: "Bad email." },
          ],
        }),
        "login",
      );
      expect(feedback.fieldErrors).toEqual({ email: "Bad email." });
      expect(feedback.general).toEqual(["Strange problem."]);
    });

    it("never turns a pointer into anything but one of the three known fields", () => {
      const feedback = describeAuthError(
        apiError(400, {
          issues: [
            { pointer: "/__proto__", message: "A." },
            { pointer: "/constructor", message: "B." },
            { pointer: "/email/extra", message: "C." },
            { pointer: "email", message: "D." },
          ],
        }),
        "login",
      );
      expect(feedback.fieldErrors).toEqual({});
      expect(Object.keys(feedback.fieldErrors)).toEqual([]);
      expect(feedback.general).toEqual(["A.", "B.", "C.", "D."]);
    });

    it("asks to check the input when the server gave no details", () => {
      const feedback = describeAuthError(apiError(400), "login");
      expect(feedback.general).toEqual(["Please check what you entered and try again."]);
    });
  });

  describe("401", () => {
    it("is one message for a login, so nobody learns whether the email exists", () => {
      const feedback = describeAuthError(apiError(401, { code: "unauthorized" }), "login");
      expect(feedback).toEqual({ fieldErrors: {}, general: ["Email or password is incorrect."] });
    });

    it("is a generic problem when it comes from the sign-up form", () => {
      expect(describeAuthError(apiError(401), "register").general).toEqual([GENERIC]);
    });
  });

  describe("409", () => {
    it("says the email is taken, under the email field, on the sign-up form", () => {
      const feedback = describeAuthError(apiError(409, { code: "conflict" }), "register");
      expect(feedback).toEqual({
        fieldErrors: { email: "That email is already registered." },
        general: [],
      });
    });

    it("is a generic problem on the login form", () => {
      expect(describeAuthError(apiError(409), "login").general).toEqual([GENERIC]);
    });
  });

  describe("429", () => {
    it("says how long to wait", () => {
      expect(describeAuthError(apiError(429, { retryAfterSeconds: 42 }), "login").general).toEqual([
        "Too many attempts. Try again in 42 seconds.",
      ]);
    });

    it("says 'second' for one second", () => {
      expect(describeAuthError(apiError(429, { retryAfterSeconds: 1 }), "login").general).toEqual([
        "Too many attempts. Try again in 1 second.",
      ]);
    });

    it("says to wait when the server did not say how long", () => {
      expect(describeAuthError(apiError(429), "login").general).toEqual([
        "Too many attempts. Please wait a moment and try again.",
      ]);
    });

    it("works the same on the sign-up form", () => {
      expect(
        describeAuthError(apiError(429, { retryAfterSeconds: 3600 }), "register").general,
      ).toEqual(["Too many attempts. Try again in 3600 seconds."]);
    });
  });

  it("says the service is busy for a 503", () => {
    expect(describeAuthError(apiError(503), "login").general).toEqual([
      "The service is busy. Try again in a moment.",
    ]);
  });

  it("says the server cannot be reached when there was no answer", () => {
    expect(describeAuthError(new NetworkError(), "login").general).toEqual([
      "Can't reach the server. Check your connection and try again.",
    ]);
  });

  describe("everything else is the generic message, never the server's own text", () => {
    it.each([
      ["a 403", apiError(403, { detail: "secret internal detail" })],
      ["a 404", apiError(404, { detail: "secret internal detail" })],
      ["a 413", apiError(413, { detail: "secret internal detail" })],
      ["a 415", apiError(415, { detail: "secret internal detail" })],
      ["a 500", apiError(500, { detail: "secret internal detail", code: "internal" })],
      ["a 502 from a proxy", apiError(502)],
      ["an answer in the wrong shape", new ResponseShapeError("odd")],
      ["a plain error", new Error("boom: secret stack")],
      ["a thrown string", "text"],
      ["undefined", undefined],
    ])("%s", (_name, error) => {
      const feedback = describeAuthError(error, "login");
      expect(feedback).toEqual({ fieldErrors: {}, general: [GENERIC] });
      expect(JSON.stringify(feedback)).not.toContain("secret");
    });
  });

  it("does not use the detail of a 400, 401, 409 or 429 either", () => {
    for (const status of [400, 401, 409, 429, 503]) {
      const feedback = describeAuthError(
        apiError(status, { detail: "secret internal detail" }),
        "register",
      );
      expect(JSON.stringify(feedback)).not.toContain("secret");
    }
  });
});

describe("validateRequired", () => {
  it("accepts a login with both fields filled in", () => {
    expect(validateRequired({ email: "a@b.test", password: "x" }, "login")).toBeUndefined();
  });

  it("asks for the email and the password on the login form", () => {
    expect(validateRequired({ email: "", password: "" }, "login")).toEqual({
      fieldErrors: { email: "Enter your email address.", password: "Enter your password." },
      general: [],
    });
  });

  it("asks for a password, not 'your' password, on the sign-up form", () => {
    expect(validateRequired({ email: "", password: "" }, "register")).toEqual({
      fieldErrors: { email: "Enter your email address.", password: "Enter a password." },
      general: [],
    });
  });

  it("asks only for what is missing", () => {
    expect(validateRequired({ email: "a@b.test", password: "" }, "login")?.fieldErrors).toEqual({
      password: "Enter your password.",
    });
    expect(validateRequired({ email: "", password: "x" }, "login")?.fieldErrors).toEqual({
      email: "Enter your email address.",
    });
  });

  it("treats an email of only spaces as missing, but never a password", () => {
    expect(validateRequired({ email: "   ", password: "x" }, "login")?.fieldErrors).toEqual({
      email: "Enter your email address.",
    });
    expect(validateRequired({ email: "a@b.test", password: "   " }, "login")).toBeUndefined();
  });
});

describe("summaryItems", () => {
  const link = (feedback: FormFeedback) =>
    summaryItems(feedback, {
      email: "login-email",
      password: "login-password",
      displayName: "login-display-name",
    });

  it("lists the field problems in the order of the form, each linked to its field", () => {
    expect(
      link({
        fieldErrors: { password: "P.", email: "E.", displayName: "D." },
        general: [],
      }),
    ).toEqual([
      { message: "E.", fieldId: "login-email" },
      { message: "P.", fieldId: "login-password" },
      { message: "D.", fieldId: "login-display-name" },
    ]);
  });

  it("puts general problems last, without a link", () => {
    expect(link({ fieldErrors: { email: "E." }, general: ["G1.", "G2."] })).toEqual([
      { message: "E.", fieldId: "login-email" },
      { message: "G1." },
      { message: "G2." },
    ]);
  });

  it("is empty when nothing is wrong", () => {
    expect(link({ fieldErrors: {}, general: [] })).toEqual([]);
  });
});
