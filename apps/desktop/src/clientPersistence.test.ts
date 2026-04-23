import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  EnvironmentId,
  type ClientSettings,
  type PersistedSavedEnvironmentRecord,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readClientSettings,
  readSavedEnvironmentRegistry,
  readSavedEnvironmentSecret,
  readSavedPromptStorageWithRecovery,
  removeSavedPromptStorage,
  removeSavedEnvironmentSecret,
  writeClientSettings,
  writeSavedEnvironmentRegistry,
  writeSavedEnvironmentSecret,
  writeSavedPromptStorage,
  type DesktopSecretStorage,
} from "./clientPersistence.ts";

const tempDirectories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempPath(fileName: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "t3-client-persistence-test-"));
  tempDirectories.push(directory);
  return path.join(directory, fileName);
}

function makeSecretStorage(available: boolean): DesktopSecretStorage {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (value) => {
      const decoded = value.toString("utf8");
      if (!decoded.startsWith("enc:")) {
        throw new Error("invalid secret");
      }
      return decoded.slice("enc:".length);
    },
  };
}

const clientSettings: ClientSettings = {
  autoOpenPlanSidebar: false,
  confirmThreadArchive: true,
  confirmThreadDelete: false,
  diffWordWrap: true,
  favorites: [],
  sidebarProjectGroupingMode: "repository_path",
  sidebarProjectGroupingOverrides: {
    "environment-1:/tmp/project-a": "separate",
  },
  sidebarProjectSortOrder: "manual",
  sidebarThreadSortOrder: "created_at",
  timestampFormat: "24-hour",
  worktreeSetupPromptStateByProjectId: {},
};

const savedRegistryRecord: PersistedSavedEnvironmentRecord = {
  environmentId: EnvironmentId.make("environment-1"),
  label: "Remote environment",
  httpBaseUrl: "https://remote.example.com/",
  wsBaseUrl: "wss://remote.example.com/",
  createdAt: "2026-04-09T00:00:00.000Z",
  lastConnectedAt: "2026-04-09T01:00:00.000Z",
};

function makeSavedPromptDocument(title = "Review diff"): string {
  return JSON.stringify({
    version: 1,
    state: {
      snippetsById: {
        "snippet-1": {
          id: "snippet-1",
          title,
          body: "Review the diff",
          scope: "global",
          projectKey: null,
          createdAt: "2026-04-19T12:00:00.000Z",
          updatedAt: "2026-04-19T12:00:00.000Z",
          lastUsedAt: null,
        },
      },
    },
  });
}

describe("clientPersistence", () => {
  it("persists and reloads client settings", () => {
    const settingsPath = makeTempPath("client-settings.json");

    writeClientSettings(settingsPath, clientSettings);

    expect(readClientSettings(settingsPath)).toEqual(clientSettings);
  });

  it("persists and reloads saved prompt storage", () => {
    const storagePath = makeTempPath("saved-prompts.json");
    const document = JSON.stringify({
      version: 1,
      state: {
        snippetsById: {
          "snippet-1": {
            id: "snippet-1",
            title: "Review diff",
            body: "Review the diff",
            scope: "global",
            projectKey: null,
            createdAt: "2026-04-19T12:00:00.000Z",
            updatedAt: "2026-04-19T12:00:00.000Z",
            lastUsedAt: null,
          },
        },
      },
    });

    writeSavedPromptStorage(storagePath, document);

    expect(readSavedPromptStorageWithRecovery(storagePath)).toEqual({
      status: "ok",
      value: document,
    });
  });

  it("returns missing for absent saved prompt storage", () => {
    const storagePath = makeTempPath("saved-prompts.json");

    expect(readSavedPromptStorageWithRecovery(storagePath)).toEqual({ status: "missing" });
  });

  it("quarantines corrupt saved prompt storage", () => {
    const storagePath = makeTempPath("saved-prompts.json");

    fs.writeFileSync(storagePath, "{not-json", "utf8");

    const result = readSavedPromptStorageWithRecovery(storagePath);

    expect(result).toMatchObject({
      status: "corrupt",
      message: expect.any(String),
      backupPath: expect.stringContaining("saved-prompts.corrupt-"),
    });
    if (result.status !== "corrupt" || !result.backupPath) {
      throw new Error("Expected corrupt result with backup path.");
    }
    expect(fs.existsSync(storagePath)).toBe(false);
    expect(fs.readFileSync(result.backupPath, "utf8")).toBe("{not-json");
  });

  it("returns error for unreadable saved prompt storage", () => {
    const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "t3-saved-prompts-dir-test-"));
    tempDirectories.push(storagePath);

    expect(readSavedPromptStorageWithRecovery(storagePath)).toMatchObject({
      status: "error",
      message: expect.any(String),
    });
  });

  it("rejects invalid saved prompt storage writes", () => {
    const storagePath = makeTempPath("saved-prompts.json");

    expect(() => writeSavedPromptStorage(storagePath, "{not-json")).toThrow(
      "Invalid saved prompt storage payload.",
    );
  });

  it("quarantines existing corrupt saved prompt storage before writing", () => {
    const storagePath = makeTempPath("saved-prompts.json");
    const nextDocument = makeSavedPromptDocument("Recovered write");

    fs.writeFileSync(storagePath, "{not-json", "utf8");

    writeSavedPromptStorage(storagePath, nextDocument);

    expect(fs.readFileSync(storagePath, "utf8")).toBe(nextDocument);
    const backups = fs
      .readdirSync(path.dirname(storagePath))
      .filter((fileName) => fileName.startsWith("saved-prompts.corrupt-"));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(path.dirname(storagePath), backups[0]!), "utf8")).toBe(
      "{not-json",
    );
  });

  it("does not overwrite existing corrupt saved prompt storage when preflight quarantine fails", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T12:00:00.000Z"));
    const storagePath = makeTempPath("saved-prompts.json");
    const backupPath = path.join(
      path.dirname(storagePath),
      "saved-prompts.corrupt-2026-04-29T12-00-00-000Z.json",
    );
    fs.writeFileSync(storagePath, "{not-json", "utf8");
    fs.mkdirSync(backupPath);

    expect(() => writeSavedPromptStorage(storagePath, makeSavedPromptDocument())).toThrow(
      "Failed to preserve corrupt saved prompt storage before write",
    );
    expect(fs.readFileSync(storagePath, "utf8")).toBe("{not-json");
  });

  it("fails saved prompt storage writes when the existing file cannot be read", () => {
    const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "t3-saved-prompts-dir-test-"));
    tempDirectories.push(storagePath);

    expect(() => writeSavedPromptStorage(storagePath, makeSavedPromptDocument())).toThrow();
  });

  it("writes over existing valid saved prompt storage", () => {
    const storagePath = makeTempPath("saved-prompts.json");
    const nextDocument = makeSavedPromptDocument("Next prompt");

    fs.writeFileSync(storagePath, JSON.stringify({ version: 1, state: {} }), "utf8");
    writeSavedPromptStorage(storagePath, nextDocument);

    expect(fs.readFileSync(storagePath, "utf8")).toBe(nextDocument);
  });

  it("removes saved prompt storage and ignores missing files", () => {
    const storagePath = makeTempPath("saved-prompts.json");

    writeSavedPromptStorage(storagePath, JSON.stringify({ version: 1, state: {} }));
    removeSavedPromptStorage(storagePath);
    removeSavedPromptStorage(storagePath);

    expect(readSavedPromptStorageWithRecovery(storagePath)).toEqual({ status: "missing" });
  });

  it("propagates non-missing saved prompt storage remove failures", () => {
    const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "t3-saved-prompts-dir-test-"));
    tempDirectories.push(storagePath);

    expect(() => removeSavedPromptStorage(storagePath)).toThrow();
  });

  it("persists and reloads saved environment metadata", () => {
    const registryPath = makeTempPath("saved-environments.json");

    writeSavedEnvironmentRegistry(registryPath, [savedRegistryRecord]);

    expect(readSavedEnvironmentRegistry(registryPath)).toEqual([savedRegistryRecord]);
  });

  it("persists encrypted saved environment secrets when encryption is available", () => {
    const registryPath = makeTempPath("saved-environments.json");
    const secretStorage = makeSecretStorage(true);

    writeSavedEnvironmentRegistry(registryPath, [savedRegistryRecord]);

    expect(
      writeSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secret: "bearer-token",
        secretStorage,
      }),
    ).toBe(true);

    expect(
      readSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage,
      }),
    ).toBe("bearer-token");

    expect(JSON.parse(fs.readFileSync(registryPath, "utf8"))).toEqual({
      records: [
        {
          ...savedRegistryRecord,
          encryptedBearerToken: Buffer.from("enc:bearer-token", "utf8").toString("base64"),
        },
      ],
    });
  });

  it("preserves existing secrets when encryption is unavailable", () => {
    const registryPath = makeTempPath("saved-environments.json");
    const availableSecretStorage = makeSecretStorage(true);

    writeSavedEnvironmentRegistry(registryPath, [savedRegistryRecord]);

    writeSavedEnvironmentSecret({
      registryPath,
      environmentId: savedRegistryRecord.environmentId,
      secret: "bearer-token",
      secretStorage: availableSecretStorage,
    });

    expect(
      writeSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secret: "next-token",
        secretStorage: makeSecretStorage(false),
      }),
    ).toBe(false);

    expect(
      readSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage: availableSecretStorage,
      }),
    ).toBe("bearer-token");
  });

  it("removes saved environment secrets", () => {
    const registryPath = makeTempPath("saved-environments.json");
    const secretStorage = makeSecretStorage(true);

    writeSavedEnvironmentRegistry(registryPath, [savedRegistryRecord]);

    writeSavedEnvironmentSecret({
      registryPath,
      environmentId: savedRegistryRecord.environmentId,
      secret: "bearer-token",
      secretStorage,
    });

    removeSavedEnvironmentSecret({
      registryPath,
      environmentId: savedRegistryRecord.environmentId,
    });

    expect(
      readSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage,
      }),
    ).toBeNull();
  });

  it("treats malformed secrets documents as empty", () => {
    const registryPath = makeTempPath("saved-environments.json");
    fs.writeFileSync(registryPath, "{}\n", "utf8");

    expect(
      readSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage: makeSecretStorage(true),
      }),
    ).toBeNull();

    expect(() =>
      removeSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
      }),
    ).not.toThrow();
  });

  it("returns false when writing a secret without metadata", () => {
    const registryPath = makeTempPath("saved-environments.json");

    expect(
      writeSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secret: "bearer-token",
        secretStorage: makeSecretStorage(true),
      }),
    ).toBe(false);
  });

  it("preserves encrypted secrets when metadata is rewritten", () => {
    const registryPath = makeTempPath("saved-environments.json");
    const secretStorage = makeSecretStorage(true);

    writeSavedEnvironmentRegistry(registryPath, [savedRegistryRecord]);

    writeSavedEnvironmentSecret({
      registryPath,
      environmentId: savedRegistryRecord.environmentId,
      secret: "bearer-token",
      secretStorage,
    });

    writeSavedEnvironmentRegistry(registryPath, [savedRegistryRecord]);

    expect(readSavedEnvironmentRegistry(registryPath)).toEqual([savedRegistryRecord]);
    expect(
      readSavedEnvironmentSecret({
        registryPath,
        environmentId: savedRegistryRecord.environmentId,
        secretStorage,
      }),
    ).toBe("bearer-token");
  });
});
