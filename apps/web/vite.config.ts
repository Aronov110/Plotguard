import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { createApiProxy } from "./src/lib/dev-proxy.ts";

export default defineConfig(({ mode }) => {
  // Only `API_URL` is read from the environment (and from apps/web/.env*). It is optional.
  const proxy = createApiProxy(loadEnv(mode, ".", "API_").API_URL);

  return {
    plugins: [react()],
    server: { host: "127.0.0.1", port: 5173, proxy },
    // `vite preview` serves the production build; it needs the same forwarding to reach the API.
    preview: { host: "127.0.0.1", port: 4173, proxy },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test-setup.ts"],
      // CSS is ignored in tests (jsdom does no layout) except the tokens file, whose colors are
      // read by tokens.test.ts to check their contrast.
      css: { include: /tokens\.css/ },
    },
  };
});
