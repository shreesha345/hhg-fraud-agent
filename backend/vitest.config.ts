import { defineConfig } from "vitest/config";
// STORE=tigergraph runs the same suite against the cloud graph (FraudTest) through the MCP server: slower, so a longer timeout and one worker.
const tg = process.env.STORE === "tigergraph";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup.ts"], reporters: ["default"],
    testTimeout: tg ? 240000 : 30000, hookTimeout: tg ? 240000 : 30000,
    ...(tg ? { fileParallelism: false } : {}),
  },
});
