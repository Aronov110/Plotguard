import { setupServer } from "msw/node";

/**
 * The fake API for tests. It answers network calls so no test needs a real server. Tests add their
 * own answers with `server.use(...)`; they are forgotten after each test (see `test-setup.ts`).
 */
export const server = setupServer();
