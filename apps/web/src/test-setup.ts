import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { clearAccessToken } from "./lib/auth/token-store.ts";
import { clearAllCookies } from "./test-support/cookies.ts";
import { server } from "./test-support/msw-server.ts";

// A request that no test planned for fails the test instead of silently reaching a real server.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  server.resetHandlers();
  clearAllCookies();
  clearAccessToken();
});

afterAll(() => server.close());
