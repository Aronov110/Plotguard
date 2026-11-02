import { describe, expect, it } from "vitest";
import { ApiError, NetworkError, ResponseShapeError, readProblem } from "../problem.ts";

function problem(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 400,
    headers: { "content-type": "application/problem+json" },
    ...init,
  });
}

describe("readProblem", () => {
  it("reads the status, code, detail and field issues of a Problem Details body", async () => {
    const error = await readProblem(
      problem({
        type: "urn:plotpal:problem:validation-error",
        title: "Validation Failed",
        status: 400,
        detail: "The request is invalid. See the errors member for details.",
        errors: [
          { source: "body", pointer: "/email", message: "Enter a valid email address." },
          { source: "body", pointer: "/password", message: "Use at least 12 characters." },
        ],
      }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("validation-error");
    expect(error.detail).toBe("The request is invalid. See the errors member for details.");
    expect(error.issues).toEqual([
      { pointer: "/email", message: "Enter a valid email address." },
      { pointer: "/password", message: "Use at least 12 characters." },
    ]);
  });

  it("takes the status from the response, not from the body", async () => {
    const error = await readProblem(problem({ status: 200 }, { status: 409 }));
    expect(error.status).toBe(409);
  });

  it("has no code when the type is not one of ours", async () => {
    const error = await readProblem(problem({ type: "https://example.com/probs/out-of-credit" }));
    expect(error.code).toBeUndefined();
  });

  it("has no code when the type is missing or not a string", async () => {
    expect((await readProblem(problem({}))).code).toBeUndefined();
    expect((await readProblem(problem({ type: 42 }))).code).toBeUndefined();
  });

  it("has no code when the part after the prefix is empty", async () => {
    const error = await readProblem(problem({ type: "urn:plotpal:problem:" }));
    expect(error.code).toBeUndefined();
  });

  it("ignores malformed items in the errors list and keeps the good ones", async () => {
    const error = await readProblem(
      problem({
        errors: [
          null,
          "text",
          42,
          { pointer: "/email" },
          { message: "no pointer" },
          { pointer: 7, message: "wrong type" },
          { pointer: "/password", message: "Too short." },
        ],
      }),
    );
    expect(error.issues).toEqual([{ pointer: "/password", message: "Too short." }]);
  });

  it("has no issues when errors is not a list", async () => {
    expect((await readProblem(problem({ errors: "nope" }))).issues).toEqual([]);
    expect(
      (await readProblem(problem({ errors: { pointer: "/a", message: "b" } }))).issues,
    ).toEqual([]);
  });

  it("copes with a body that is not an object", async () => {
    for (const body of [null, [], "text", 12, true]) {
      const error = await readProblem(problem(body));
      expect(error.status).toBe(400);
      expect(error.code).toBeUndefined();
      expect(error.issues).toEqual([]);
    }
  });

  it("copes with an HTML error page, such as one from a proxy", async () => {
    const error = await readProblem(
      new Response("<html><body>502 Bad Gateway</body></html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    );
    expect(error.status).toBe(502);
    expect(error.code).toBeUndefined();
    expect(error.detail).toBeUndefined();
    expect(error.issues).toEqual([]);
  });

  it("copes with an empty body", async () => {
    const error = await readProblem(new Response(null, { status: 500 }));
    expect(error.status).toBe(500);
    expect(error.issues).toEqual([]);
  });

  it("ignores a detail that is not a string", async () => {
    const error = await readProblem(problem({ detail: { nested: true } }));
    expect(error.detail).toBeUndefined();
  });

  describe("Retry-After", () => {
    const withHeader = (value: string) =>
      readProblem(problem({}, { status: 429, headers: { "retry-after": value } }));

    it("reads whole seconds", async () => {
      expect((await withHeader("30")).retryAfterSeconds).toBe(30);
    });

    it("raises zero to one second", async () => {
      expect((await withHeader("0")).retryAfterSeconds).toBe(1);
    });

    it("caps absurd values at one hour", async () => {
      expect((await withHeader("99999999")).retryAfterSeconds).toBe(3600);
    });

    it("ignores dates, decimals, negatives and text", async () => {
      expect((await withHeader("Wed, 21 Oct 2026 07:28:00 GMT")).retryAfterSeconds).toBeUndefined();
      expect((await withHeader("1.5")).retryAfterSeconds).toBeUndefined();
      expect((await withHeader("-5")).retryAfterSeconds).toBeUndefined();
      expect((await withHeader("soon")).retryAfterSeconds).toBeUndefined();
      expect((await withHeader("")).retryAfterSeconds).toBeUndefined();
    });

    it("is absent when the header is absent", async () => {
      expect((await readProblem(problem({}))).retryAfterSeconds).toBeUndefined();
    });
  });
});

describe("readProblem: untrusted text", () => {
  it("cuts a long field message at 300 characters", async () => {
    const error = await readProblem(
      problem({ errors: [{ pointer: "/email", message: "x".repeat(5000) }] }),
    );
    expect(error.issues[0]?.message).toHaveLength(300);
  });

  it("cuts a long pointer at 200 characters", async () => {
    const error = await readProblem(
      problem({ errors: [{ pointer: `/${"p".repeat(5000)}`, message: "bad" }] }),
    );
    expect(error.issues[0]?.pointer).toHaveLength(200);
  });

  it("cuts a long detail at 500 characters", async () => {
    const error = await readProblem(problem({ detail: "d".repeat(5000) }));
    expect(error.detail).toHaveLength(500);
  });

  it("does not cut a normal message", async () => {
    const message = "Use at least 12 characters, with spaces if you like.";
    const error = await readProblem(problem({ errors: [{ pointer: "/password", message }] }));
    expect(error.issues[0]?.message).toBe(message);
  });

  it("does not split an emoji when it cuts", async () => {
    const error = await readProblem(
      problem({ errors: [{ pointer: "/a", message: "😀".repeat(400) }] }),
    );
    expect(error.issues[0]?.message).toBe("😀".repeat(300));
  });

  it("turns line breaks, tabs and other control characters into spaces", async () => {
    const error = await readProblem(
      problem({
        detail: "line one\nline two\r\n\tindented\u0000\u001b[31mred",
        errors: [{ pointer: "/a", message: "first\nsecond" }],
      }),
    );
    expect(error.detail).toBe("line one line two   indented  [31mred");
    expect(error.issues[0]?.message).toBe("first second");
  });

  it("removes invisible and direction-changing characters that could disguise text", async () => {
    const error = await readProblem(
      problem({
        errors: [{ pointer: "/a", message: "pay‮evil​⁦text﻿" }],
      }),
    );
    expect(error.issues[0]?.message).toBe("payeviltext");
  });

  it("trims spaces around the text", async () => {
    const error = await readProblem(problem({ detail: "   spaced   " }));
    expect(error.detail).toBe("spaced");
  });

  it("drops an issue whose message or pointer is empty after cleaning", async () => {
    const error = await readProblem(
      problem({
        errors: [
          { pointer: "/a", message: "​​" },
          { pointer: "\u0000", message: "ok text" },
          { pointer: "/b", message: "kept" },
        ],
      }),
    );
    expect(error.issues).toEqual([{ pointer: "/b", message: "kept" }]);
  });

  it("keeps at most 20 issues", async () => {
    const errors = Array.from({ length: 100 }, (_, index) => ({
      pointer: `/f${index}`,
      message: `m${index}`,
    }));
    const error = await readProblem(problem({ errors }));
    expect(error.issues).toHaveLength(20);
    expect(error.issues[0]?.pointer).toBe("/f0");
  });

  it.each([
    ["a line break", "urn:plotpal:problem:bad\ncode"],
    ["capital letters", "urn:plotpal:problem:Bad"],
    ["spaces", "urn:plotpal:problem:two words"],
    ["a script tag", "urn:plotpal:problem:<script>"],
    ["more than 64 characters", `urn:plotpal:problem:${"a".repeat(65)}`],
  ])("has no code when the code part has %s", async (_name, type) => {
    expect((await readProblem(problem({ type }))).code).toBeUndefined();
  });

  it("keeps a normal code, also with digits and dashes", async () => {
    const error = await readProblem(problem({ type: "urn:plotpal:problem:rate-limited-2" }));
    expect(error.code).toBe("rate-limited-2");
  });

  it("treats a detail that is empty after cleaning as missing", async () => {
    const error = await readProblem(problem({ detail: "\n\t " }));
    expect(error.detail).toBeUndefined();
  });
});

describe("error classes", () => {
  it("ApiError is an Error with a stable name and a message that carries no server text", async () => {
    const error = await readProblem(problem({ detail: "secret-detail-from-server" }));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
    expect(error.message).toBe("The API answered with status 400.");
  });

  it("NetworkError keeps its cause", () => {
    const cause = new TypeError("Failed to fetch");
    const error = new NetworkError({ cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("NetworkError");
    expect(error.cause).toBe(cause);
  });

  it("ResponseShapeError is an Error with a stable name", () => {
    const error = new ResponseShapeError("The login answer had an unexpected shape.");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ResponseShapeError");
  });
});
