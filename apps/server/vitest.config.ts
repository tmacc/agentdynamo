import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // The server suite exercises sqlite, git, temp worktrees, and orchestration
      // runtimes heavily. Running files in parallel introduces load-sensitive flakes.
      fileParallelism: false,
      // Server integration tests exercise sqlite, git, and orchestration together.
      // CI runners can spend long stretches in sqlite/git/provider projection waits
      // during package-wide runs, so keep the Vitest budget above the harness wait.
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  }),
);
