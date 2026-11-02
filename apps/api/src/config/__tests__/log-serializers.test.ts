import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { serializeError, serializeRequest } from "../log-serializers.ts";

const SENTINEL = "SENTINEL-4f9c1e";

/** A driver error shaped like the one `pg` throws. */
function pgError(
  message: string,
  fields: Record<string, string>,
  code: string,
  severity = "ERROR",
): Error {
  return Object.assign(new Error(message), { code, severity, ...fields });
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe("serializeError", () => {
  describe("Drizzle query errors", () => {
    const query = 'insert into "users" ("email", "password_hash") values ($1, $2)';
    const driverError = pgError(
      'duplicate key value violates unique constraint "users_email_key"',
      {
        detail: `Key (email)=(${SENTINEL}@example.com) already exists.`,
        table: "users",
        constraint: "users_email_key",
        schema: "public",
        where: `SQL statement with ${SENTINEL}`,
      },
      "23505",
    );
    const error = new DrizzleQueryError(
      query,
      [`${SENTINEL}@example.com`, "$argon2id$hash"],
      driverError,
    );

    it("never contains the bound parameters anywhere", () => {
      expect(json(serializeError(error))).not.toContain(SENTINEL);
      expect(json(serializeError(error))).not.toContain("argon2id");
    });

    it("keeps the query text, which holds placeholders instead of values", () => {
      const out = serializeError(error) as { message: string; query: string; type: string };
      expect(out.type).toBe("DrizzleQueryError");
      expect(out.query).toBe(query);
      expect(out.message).toBe(`Failed query: ${query}`);
    });

    it("rebuilds the stack from the sanitised message", () => {
      const out = serializeError(error) as { stack: string };
      expect(out.stack).toContain(`Failed query: ${query}`);
      expect(out.stack).not.toContain("params:");
      expect(out.stack).toContain("at ");
    });

    it("keeps the SQLSTATE, constraint and table of the driver error", () => {
      const out = serializeError(error) as { cause: Record<string, unknown> };
      expect(out.cause).toMatchObject({
        code: "23505",
        severity: "ERROR",
        table: "users",
        constraint: "users_email_key",
        schema: "public",
      });
    });

    it("drops detail and where from the driver error", () => {
      const out = serializeError(error) as { cause: Record<string, unknown> };
      expect(out.cause).not.toHaveProperty("detail");
      expect(out.cause).not.toHaveProperty("where");
    });

    it("keeps the safe message of a constraint violation", () => {
      const out = serializeError(error) as { cause: { message: string } };
      expect(out.cause.message).toContain("users_email_key");
    });
  });

  describe("driver errors that quote values in their message", () => {
    it("omits the message of a data exception (class 22) but keeps the code", () => {
      const error = pgError(`invalid input syntax for type uuid: "${SENTINEL}"`, {}, "22P02");
      const out = serializeError(error) as Record<string, unknown>;
      expect(json(out)).not.toContain(SENTINEL);
      expect(out.code).toBe("22P02");
      expect(String(out.message)).toContain("omitted");
    });

    it("also removes the value from the stack", () => {
      const error = pgError(`invalid input syntax for type integer: "${SENTINEL}"`, {}, "22P02");
      expect(json(serializeError(error))).not.toContain(SENTINEL);
    });

    it("omits the message for an unknown SQLSTATE class", () => {
      const error = pgError(`something about ${SENTINEL}`, {}, "ZZ999");
      expect(json(serializeError(error))).not.toContain(SENTINEL);
    });

    it.each(["08006", "23502", "23514", "28P01", "40001", "42P01", "53300", "57P01"])(
      "keeps the message for SQLSTATE %s",
      (code) => {
        const out = serializeError(pgError("a harmless message", {}, code)) as { message: string };
        expect(out.message).toBe("a harmless message");
      },
    );
  });

  describe("ordinary errors", () => {
    it("keeps type, message and stack", () => {
      const out = serializeError(new TypeError("bad thing")) as Record<string, string>;
      expect(out.type).toBe("TypeError");
      expect(out.message).toBe("bad thing");
      expect(out.stack).toContain("bad thing");
    });

    it("keeps a string code such as ECONNREFUSED", () => {
      const error = Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" });
      expect((serializeError(error) as { code: string }).code).toBe("ECONNREFUSED");
    });

    it("ignores a non-string code", () => {
      const error = Object.assign(new Error("x"), { code: { nested: SENTINEL } });
      expect(json(serializeError(error))).not.toContain(SENTINEL);
    });

    it("follows the cause chain", () => {
      const error = new Error("outer", { cause: new Error("inner") });
      const out = serializeError(error) as { cause: { message: string } };
      expect(out.cause.message).toBe("inner");
    });

    it("stops after three levels of cause", () => {
      let error: Error = new Error("level-4");
      for (const name of ["level-3", "level-2", "level-1", "level-0"]) {
        error = new Error(name, { cause: error });
      }
      const text = json(serializeError(error));
      expect(text).toContain("level-0");
      expect(text).toContain("level-3");
      expect(text).not.toContain("level-4");
    });

    it("survives a circular cause", () => {
      const a = new Error("a");
      const b = new Error("b", { cause: a });
      (a as { cause?: unknown }).cause = b;
      expect(() => json(serializeError(a))).not.toThrow();
    });

    it("survives a cause that is not an error", () => {
      const out = serializeError(new Error("outer", { cause: "just a string" }));
      expect(() => json(out)).not.toThrow();
    });

    it("does not crash on an AggregateError", () => {
      const error = new AggregateError([new Error("one"), new Error("two")], "many");
      expect(() => json(serializeError(error))).not.toThrow();
    });
  });

  describe("values that are not errors", () => {
    it.each([
      ["a string", "boom"],
      ["null", null],
      ["undefined", undefined],
      ["a number", 42],
      ["a symbol", Symbol("s")],
      ["a bigint", 10n],
      ["a plain object", { password: SENTINEL }],
      ["an array", [SENTINEL]],
    ])("handles %s without throwing and stays JSON safe", (_label, value) => {
      const out = serializeError(value);
      expect(() => json(out)).not.toThrow();
      expect((out as { type: string }).type).toBe("NonError");
    });

    it("never copies the contents of a plain object", () => {
      expect(json(serializeError({ password: SENTINEL }))).not.toContain(SENTINEL);
    });

    it("truncates a long thrown string", () => {
      const out = serializeError("x".repeat(5000)) as { message: string };
      expect(out.message.length).toBeLessThanOrEqual(220);
    });
  });
});

describe("serializeRequest", () => {
  const base = {
    method: "GET",
    url: "/projects",
    host: "localhost:3000",
    ip: "127.0.0.1",
    socket: { remotePort: 51234 },
  };

  it("keeps method, host, address and port", () => {
    expect(serializeRequest(base)).toEqual({
      method: "GET",
      url: "/projects",
      host: "localhost:3000",
      remoteAddress: "127.0.0.1",
      remotePort: 51234,
    });
  });

  it("removes the query string", () => {
    const out = serializeRequest({ ...base, url: `/auth/reset?token=${SENTINEL}&x=1` });
    expect(out.url).toBe("/auth/reset");
    expect(json(out)).not.toContain(SENTINEL);
  });

  it("removes a fragment", () => {
    expect(serializeRequest({ ...base, url: `/a#${SENTINEL}` }).url).toBe("/a");
  });

  it("handles a query-only url", () => {
    expect(serializeRequest({ ...base, url: "/?a=1" }).url).toBe("/");
  });

  it("handles an encoded question mark in the path", () => {
    expect(serializeRequest({ ...base, url: "/a%3Fb?x=1" }).url).toBe("/a%3Fb");
  });

  it("copes with a missing socket and url", () => {
    const out = serializeRequest({ method: "GET" });
    expect(out.url).toBeUndefined();
    expect(out.remotePort).toBeUndefined();
  });
});
