import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ThreadId,
  type ProjectWorktreeSetupProfile,
  type TerminalOpenInput,
} from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ServerConfig } from "../../config.ts";
import { TerminalManager, type TerminalManagerShape } from "../../terminal/Services/Manager.ts";
import { WorktreeSetupRuntime } from "../Services/WorktreeSetupRuntime.ts";
import { makeWorktreeSetupRuntimeWithOptions } from "./WorktreeSetupRuntime.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dynamo-worktree-runtime-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const profile: ProjectWorktreeSetupProfile = {
  version: 1,
  status: "configured",
  scanFingerprint: "fingerprint-1",
  packageManager: "bun",
  framework: "vite",
  installCommand: "bun install",
  devCommand: "bun run dev",
  envStrategy: "none",
  envSourcePath: null,
  portCount: 5,
  storageMode: "dynamo-managed",
  autoRunSetupOnWorktreeCreate: true,
  createdAt: "2026-04-24T00:00:00.000Z",
  updatedAt: "2026-04-24T00:00:00.000Z",
};

function runtimeLayer(input: {
  readonly platform: NodeJS.Platform;
  readonly open: TerminalManagerShape["open"];
}) {
  return Layer.effect(
    WorktreeSetupRuntime,
    makeWorktreeSetupRuntimeWithOptions({ platform: input.platform }),
  ).pipe(
    Layer.provideMerge(
      Layer.succeed(TerminalManager, {
        open: input.open,
        write: () => Effect.void,
        resize: () => Effect.void,
        clear: () => Effect.void,
        restart: () => Effect.die(new Error("unused")),
        close: () => Effect.void,
        subscribe: () => Effect.succeed(() => undefined),
      }),
    ),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-worktree-runtime-test-" })),
    Layer.provideMerge(NodeServices.layer),
  );
}

describe("WorktreeSetupRuntime", () => {
  it("launches POSIX helpers with the POSIX env file on non-Windows platforms", async () => {
    const projectCwd = makeTempDir();
    execFileSync("git", ["init"], { cwd: projectCwd, stdio: "ignore" });
    const openCalls: TerminalOpenInput[] = [];
    const open: TerminalManagerShape["open"] = (input) => {
      openCalls.push(input);
      return Effect.succeed({
        threadId: "thread-1",
        terminalId: "worktree-setup",
        cwd: projectCwd,
        worktreePath: projectCwd,
        status: "running" as const,
        pid: 123,
        history: "",
        exitCode: null,
        exitSignal: null,
        updatedAt: "2026-04-24T00:00:00.000Z",
      });
    };

    const runtime = await Effect.runPromise(
      Effect.service(WorktreeSetupRuntime).pipe(
        Effect.provide(runtimeLayer({ platform: "darwin", open })),
      ),
    );

    await Effect.runPromise(
      runtime.runSetupForThread({
        threadId: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        projectCwd,
        worktreePath: projectCwd,
        profile,
      }),
    );

    const input = openCalls[0];
    expect(input?.env).toEqual({
      DYNAMO_WORKTREE_ENV_FILE: path.join(projectCwd, ".git", "dynamo", "worktree.env"),
    });
    expect(input?.initialCommand).toMatch(/^'.*setup\.sh'$/);
  });

  it("launches Windows command wrappers with the PowerShell env file on Windows", async () => {
    const projectCwd = makeTempDir();
    execFileSync("git", ["init"], { cwd: projectCwd, stdio: "ignore" });
    const openCalls: TerminalOpenInput[] = [];
    const open: TerminalManagerShape["open"] = (input) => {
      openCalls.push(input);
      return Effect.succeed({
        threadId: "thread-1",
        terminalId: "worktree-dev",
        cwd: projectCwd,
        worktreePath: projectCwd,
        status: "running" as const,
        pid: 123,
        history: "",
        exitCode: null,
        exitSignal: null,
        updatedAt: "2026-04-24T00:00:00.000Z",
      });
    };

    const runtime = await Effect.runPromise(
      Effect.service(WorktreeSetupRuntime).pipe(
        Effect.provide(runtimeLayer({ platform: "win32", open })),
      ),
    );

    await Effect.runPromise(
      runtime.runDevForThread({
        threadId: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        projectCwd,
        worktreePath: projectCwd,
        profile,
      }),
    );

    const input = openCalls[0];
    expect(input?.env).toEqual({
      DYNAMO_WORKTREE_ENV_FILE: path.join(projectCwd, ".git", "dynamo", "worktree.env.ps1"),
    });
    expect(input?.initialCommand).toContain("cmd.exe /d /s /c");
    expect(input?.initialCommand).toContain("dev.cmd");
  });
});
