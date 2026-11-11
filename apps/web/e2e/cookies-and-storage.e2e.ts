import { expect, test } from "@playwright/test";
import { signOut, signUp } from "./support/flows.ts";
import { API_ORIGIN, WEB_ORIGIN } from "./support/targets.ts";
import { uniqueUser } from "./support/users.ts";

/** What one `Set-Cookie` header says, without the parts that differ on every call. */
interface CookieShape {
  readonly name: string;
  readonly flags: readonly string[];
}

function shapeOf(header: string): CookieShape {
  const [pair = "", ...attributes] = header.split(";").map((part) => part.trim());
  const flags = attributes
    .filter((attribute) => !/^(expires|max-age)=/i.test(attribute))
    .map((attribute) => attribute.toLowerCase())
    .sort();
  return { name: pair.split("=")[0] ?? "", flags };
}

test.describe("the login cookies", () => {
  test("the proxy passes them on exactly as the API sends them", async ({ request }) => {
    const headers = { Origin: WEB_ORIGIN };
    const viaProxy = await request.post(`${WEB_ORIGIN}/auth/register`, {
      headers,
      data: { email: uniqueUser().email, password: uniqueUser().password },
    });
    const direct = await request.post(`${API_ORIGIN}/auth/register`, {
      headers,
      data: { email: uniqueUser().email, password: uniqueUser().password },
    });
    expect(viaProxy.status()).toBe(201);
    expect(direct.status()).toBe(201);

    const setCookies = (response: typeof viaProxy): CookieShape[] =>
      response
        .headersArray()
        .filter((header) => header.name.toLowerCase() === "set-cookie")
        .map((header) => shapeOf(header.value))
        .sort((a, b) => a.name.localeCompare(b.name));

    expect(setCookies(viaProxy)).toEqual(setCookies(direct));
  });

  test("the refresh cookie is HttpOnly, SameSite=Strict and limited to /auth", async ({
    request,
  }) => {
    const response = await request.post(`${WEB_ORIGIN}/auth/register`, {
      headers: { Origin: WEB_ORIGIN },
      data: { email: uniqueUser().email, password: uniqueUser().password },
    });
    const cookies = response
      .headersArray()
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .map((header) => shapeOf(header.value));

    expect(cookies.find((cookie) => cookie.name === "refresh_token")?.flags).toEqual([
      "httponly",
      "path=/auth",
      "samesite=strict",
    ]);
    // The web app has to read this one to send it back in a header, so it is not HttpOnly.
    expect(cookies.find((cookie) => cookie.name === "csrf_token")?.flags).toEqual([
      "path=/",
      "samesite=strict",
    ]);
    // Plain http (development) cannot carry Secure cookies; the production names and flags
    // (`__Host-` prefix, Secure) need https and are not covered here.
    expect(cookies.flatMap((cookie) => cookie.flags)).not.toContain("secure");
    expect(
      cookies.flatMap((cookie) => cookie.flags).some((flag) => flag.startsWith("domain")),
    ).toBe(false);
  });

  test("the browser stores them with the right flags after a sign-up", async ({
    page,
    context,
    browserName,
  }) => {
    await signUp(page, uniqueUser());
    const cookies = await context.cookies();
    const refresh = cookies.find((cookie) => cookie.name === "refresh_token");
    const csrf = cookies.find((cookie) => cookie.name === "csrf_token");

    expect(refresh).toMatchObject({ httpOnly: true, path: "/auth", secure: false });
    expect(csrf).toMatchObject({ httpOnly: false, path: "/", secure: false });
    // Playwright's WebKit reports every cookie as SameSite=None, even a Strict one. The exact
    // attribute is checked on the raw Set-Cookie header in the tests above, on both browsers.
    if (browserName === "chromium") {
      expect(refresh?.sameSite).toBe("Strict");
      expect(csrf?.sameSite).toBe("Strict");
    }
    // The page can read the CSRF code but never the refresh cookie.
    const readable = await page.evaluate(() => document.cookie);
    expect(readable).toContain("csrf_token=");
    expect(readable).not.toContain("refresh_token");
  });

  test("both cookies are gone after signing out", async ({ page, context }) => {
    await signUp(page, uniqueUser());
    await signOut(page);

    // The page shows the login screen at once, but the browser deletes the cookies only when the
    // server's sign-out answer arrives, a moment later. So wait for them to go (up to the polling
    // timeout) instead of reading them in that gap; if they never go, this still fails.
    const cookieNames = async () => (await context.cookies()).map((cookie) => cookie.name);
    await expect.poll(cookieNames).not.toContain("refresh_token");
    await expect.poll(cookieNames).not.toContain("csrf_token");
  });
});

test.describe("what the page keeps in the browser", () => {
  test("no token is stored in localStorage, sessionStorage or IndexedDB", async ({ page }) => {
    await signUp(page, uniqueUser());
    // Let the session timers and the cross-tab channel settle.
    await page.reload();
    await expect(page.getByText("Signed in as")).toBeVisible();

    const stored = await page.evaluate(async () => {
      const dump = (storage: Storage): string[] =>
        Object.keys(storage).flatMap((key) => [key, storage.getItem(key) ?? ""]);
      const databases =
        typeof indexedDB.databases === "function"
          ? (await indexedDB.databases()).map((database) => database.name ?? "")
          : [];
      return { local: dump(localStorage), session: dump(sessionStorage), databases };
    });

    const everything = [...stored.local, ...stored.session, ...stored.databases];
    // A JSON Web Token (the access token) always starts with "eyJ" and has dots in it.
    expect(everything.some((text) => /eyJ[\w-]{8,}\./.test(text))).toBe(false);
    expect(everything.some((text) => /token/i.test(text))).toBe(false);
    expect(stored.databases).toEqual([]);
  });
});
