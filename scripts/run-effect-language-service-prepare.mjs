#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const shouldSkip =
  process.env.CI === "true" ||
  process.env.CI === "1" ||
  process.env.SKIP_EFFECT_LANGUAGE_SERVICE_PATCH === "1";

if (shouldSkip) {
  console.log("[prepare] Skipping effect-language-service patch in CI.");
  process.exit(0);
}

const result = spawnSync("effect-language-service patch", {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  shell: true,
});

if (result.error) {
  console.error("[prepare] Failed to run effect-language-service patch.");
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
