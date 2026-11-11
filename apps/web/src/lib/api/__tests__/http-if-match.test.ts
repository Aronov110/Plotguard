import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../../test-support/msw-server.ts";
import { apiRequest } from "../http.ts";

/** Answers `/thing` and records the `If-Match` header of each call. */
function spy(): (string | null)[] {
  const seen: (string | null)[] = [];
  server.use(
    http.all("/thing", ({ request }) => {
      seen.push(request.headers.get("if-match"));
      return HttpResponse.json({ ok: true });
    }),
  );
  return seen;
}

describe("apiRequest: ifMatch", () => {
  it("sends the version in double quotes as If-Match", async () => {
    const seen = spy();
    await apiRequest("/thing", { method: "PATCH", json: { a: 1 }, ifMatch: 7 });
    expect(seen).toEqual(['"7"']);
  });

  it("sends no If-Match header when there is no version", async () => {
    const seen = spy();
    await apiRequest("/thing", { method: "PATCH", json: { a: 1 } });
    expect(seen).toEqual([null]);
  });

  it("sends version 1 too, which is not 'no version'", async () => {
    const seen = spy();
    await apiRequest("/thing", { method: "PATCH", json: { a: 1 }, ifMatch: 1 });
    expect(seen).toEqual(['"1"']);
  });
});
