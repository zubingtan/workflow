import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["test/runtime/**/*.integration.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
