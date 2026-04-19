import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";

import { Effect, Layer } from "effect";

import {
  normalizePortBlockBase,
  readWorktreeLocalEnv,
  serializeWorktreeLocalEnv,
  WORKTREE_LOCAL_ENV_PATH,
} from "./WorktreeReadinessShared.ts";
import {
  WorktreeRuntimeEnvProvisioner,
  type WorktreeRuntimeEnvProvisionedFile,
  type WorktreeRuntimeEnvProvisionerShape,
} from "../Services/WorktreeRuntimeEnvProvisioner.ts";

const HOST = "127.0.0.1";

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen({ host: HOST, port });
  });
}

const makeWorktreeRuntimeEnvProvisioner = Effect.gen(function* () {
  const ensureEnvFile: WorktreeRuntimeEnvProvisionerShape["ensureEnvFile"] = (input) =>
    Effect.promise(async () => {
      const envFilePath = path.join(input.worktreePath, WORKTREE_LOCAL_ENV_PATH);
      const existing = await readWorktreeLocalEnv(envFilePath);
      if (existing) {
        return {
          envFilePath,
          created: false,
          values: existing,
        } satisfies WorktreeRuntimeEnvProvisionedFile;
      }

      const portCount = Math.max(1, input.portCount);
      const maxIterations = Math.max(1, Math.floor((61000 - 41000 + 1) / portCount));
      let basePort = normalizePortBlockBase(input.worktreePath, portCount);

      let assignedPorts: number[] | null = null;
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const ports = Array.from({ length: portCount }, (_unused, index) => basePort + index);
        const availability = await Promise.all(ports.map((port) => canListen(port)));
        if (availability.every(Boolean)) {
          assignedPorts = ports;
          break;
        }
        basePort += portCount;
        if (basePort + portCount > 61000) {
          basePort = 41000;
        }
      }

      if (!assignedPorts) {
        throw new Error("Unable to allocate a free worktree port block.");
      }

      const values: Record<string, string> = {
        HOST,
        PORT: String(assignedPorts[0]),
        T3CODE_PRIMARY_PORT: String(assignedPorts[0]),
      };
      assignedPorts.forEach((port, index) => {
        values[`T3CODE_PORT_${index + 1}`] = String(port);
      });

      await fs.mkdir(path.dirname(envFilePath), { recursive: true });
      await fs.writeFile(envFilePath, serializeWorktreeLocalEnv(values), "utf8");
      return {
        envFilePath,
        created: true,
        values,
      } satisfies WorktreeRuntimeEnvProvisionedFile;
    });

  return {
    ensureEnvFile,
  } satisfies WorktreeRuntimeEnvProvisionerShape;
});

export const WorktreeRuntimeEnvProvisionerLive = Layer.effect(
  WorktreeRuntimeEnvProvisioner,
  makeWorktreeRuntimeEnvProvisioner,
);
