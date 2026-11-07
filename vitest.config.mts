import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/integration/**", "node_modules/**"],
    // Under 5x load (4 busy loops and lint on 2 CPUs) the slowest unit test took 8.9 s and many took 4 to 7 s; the default 5 s failed them.
    // 30 s is more than 3 times that. A test that hangs still fails; a wall-clock assertion has its own budget, named in its title.
    testTimeout: 30_000,
    setupFiles: ["tests/setup/env-defaults.ts"],
  },
});
