import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["test/definition/**/*.test.ts"],
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
