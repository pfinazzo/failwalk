import { defineConfig } from "vitest/config";

// The fixture service under tests/fixtures has Jest tests of its own. Vitest must not pick them up.
export default defineConfig({
  test: {
    include: ["tests/*.test.ts"],
    exclude: ["**/node_modules/**", "tests/fixtures/**"],
    testTimeout: 120_000,
  },
});
