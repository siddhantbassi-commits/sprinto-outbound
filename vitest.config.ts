import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Database tests boot a real Postgres (PGlite) per test. A busy laptop or a slow CI runner can take longer than the
    // 5-second default, which produced failures that were timeouts and not bugs. Generous, but still finite.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
