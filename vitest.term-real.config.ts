import { defineConfig } from "vitest/config";

/**
 * The term tool's real-model suite, `npm run test:term:real`: one
 * `term fill --crawl` run against a provider that answers for itself.
 *
 * A separate config for the reason `vitest.graph-real.config.ts` gives:
 * `vitest.config.ts` excludes `test/term/real/**`, so `npm test` never reaches
 * a network or model weights. `INFERENCE_NO_AUTO_INSTALL` is not set here,
 * because reaching a model is the point.
 */
export default defineConfig({
  test: {
    include: ["test/term/real/**/*.test.ts"],
    environment: "node",
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
