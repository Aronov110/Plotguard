import { describe, expect, it } from "vitest";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from "../app-error.ts";
import { toProblemDetails } from "../problem-details.ts";

describe("AppError subclasses", () => {
  it.each([
    ["ValidationError", new ValidationError([]), 400, "validation-error"],
    ["UnauthorizedError", new UnauthorizedError(), 401, "unauthorized"],
    ["ForbiddenError", new ForbiddenError(), 403, "forbidden"],
    ["NotFoundError", new NotFoundError(), 404, "not-found"],
    ["ConflictError", new ConflictError(), 409, "conflict"],
    ["RateLimitError", new RateLimitError(5), 429, "rate-limited"],
  ])("%s has the expected status and code", (name, error, status, code) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.title.length).toBeGreaterThan(0);
    expect(error.detail.length).toBeGreaterThan(0);
  });

  it("accepts a custom detail", () => {
    expect(new ConflictError("That email is already registered.").detail).toBe(
      "That email is already registered.",
    );
  });

  it("keeps the original error as the cause", () => {
    const cause = new Error("db unique violation");
    expect(new ConflictError("Taken.", { cause }).cause).toBe(cause);
  });

  it("uses the detail as the Error message", () => {
    expect(new NotFoundError("No such project.").message).toBe("No such project.");
  });

  it("asks for Bearer credentials on 401", () => {
    expect(new UnauthorizedError().headers["www-authenticate"]).toBe("Bearer");
  });

  it("exposes validation issues as an extension", () => {
    const issues = [{ source: "body", pointer: "/email", message: "Invalid email address" }];
    expect(new ValidationError(issues).extensions).toEqual({ errors: issues });
  });
});

describe("RateLimitError", () => {
  it("sets Retry-After in whole seconds", () => {
    expect(new RateLimitError(30).headers["retry-after"]).toBe("30");
  });

  it("rounds fractional seconds up", () => {
    expect(new RateLimitError(0.2).headers["retry-after"]).toBe("1");
    expect(new RateLimitError(2.1).headers["retry-after"]).toBe("3");
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back to 1 second for %s",
    (seconds) => {
      expect(new RateLimitError(seconds).headers["retry-after"]).toBe("1");
    },
  );
});

describe("toProblemDetails", () => {
  it("maps an AppError to RFC 9457 members", () => {
    const problem = toProblemDetails(new NotFoundError("No such project."));
    expect(problem).toEqual({
      type: "urn:plotpal:problem:not-found",
      title: "Not Found",
      status: 404,
      detail: "No such project.",
    });
  });

  it("includes instance only when given", () => {
    expect(toProblemDetails(new NotFoundError())).not.toHaveProperty("instance");
    expect(toProblemDetails(new NotFoundError(), "/projects/1").instance).toBe("/projects/1");
  });

  it("includes extension members", () => {
    const issues = [{ source: "body", pointer: "/title", message: "Required" }];
    expect(toProblemDetails(new ValidationError(issues)).errors).toEqual(issues);
  });

  it("never lets an extension overwrite a standard member", () => {
    const error = new AppError({
      status: 400,
      code: "custom",
      title: "Custom",
      detail: "Real detail",
      extensions: { status: 200, type: "evil", title: "Evil", detail: "Evil detail" },
    });
    const problem = toProblemDetails(error);
    expect(problem.status).toBe(400);
    expect(problem.type).toBe("urn:plotpal:problem:custom");
    expect(problem.title).toBe("Custom");
    expect(problem.detail).toBe("Real detail");
  });
});
