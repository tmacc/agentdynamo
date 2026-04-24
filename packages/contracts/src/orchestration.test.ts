import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  OrchestrationCommand,
  OrchestrationContextHandoffRenderStats,
  OrchestrationEvent,
  OrchestrationGetTurnDiffInput,
  OrchestrationLatestTurn,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  ProjectCreatedPayload,
  ProjectWorktreeSetupProfile,
  ProjectMetaUpdatedPayload,
  OrchestrationProposedPlan,
  OrchestrationSession,
  ProjectCreateCommand,
  ThreadMetaUpdatedPayload,
  ThreadTurnStartCommand,
  ThreadCreatedPayload,
  ThreadTurnDiff,
  ThreadTurnStartRequestedPayload,
} from "./orchestration.ts";
import { ProjectApplyWorktreeSetupInput, ProjectScanWorktreeSetupResult } from "./project.ts";
import { WS_METHODS } from "./rpc.ts";

const decodeTurnDiffInput = Schema.decodeUnknownEffect(OrchestrationGetTurnDiffInput);
const decodeThreadTurnDiff = Schema.decodeUnknownEffect(ThreadTurnDiff);
const decodeProjectCreateCommand = Schema.decodeUnknownEffect(ProjectCreateCommand);
const decodeProjectCreatedPayload = Schema.decodeUnknownEffect(ProjectCreatedPayload);
const decodeProjectWorktreeSetupProfile = Schema.decodeUnknownEffect(ProjectWorktreeSetupProfile);
const decodeProjectMetaUpdatedPayload = Schema.decodeUnknownEffect(ProjectMetaUpdatedPayload);
const decodeProjectApplyWorktreeSetupInput = Schema.decodeUnknownEffect(
  ProjectApplyWorktreeSetupInput,
);
const decodeProjectScanWorktreeSetupResult = Schema.decodeUnknownEffect(
  ProjectScanWorktreeSetupResult,
);
const decodeThreadTurnStartCommand = Schema.decodeUnknownEffect(ThreadTurnStartCommand);
const decodeThreadTurnStartRequestedPayload = Schema.decodeUnknownEffect(
  ThreadTurnStartRequestedPayload,
);
const decodeOrchestrationLatestTurn = Schema.decodeUnknownEffect(OrchestrationLatestTurn);
const decodeOrchestrationReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
const decodeOrchestrationShellSnapshot = Schema.decodeUnknownEffect(OrchestrationShellSnapshot);
const decodeOrchestrationProposedPlan = Schema.decodeUnknownEffect(OrchestrationProposedPlan);
const decodeOrchestrationSession = Schema.decodeUnknownEffect(OrchestrationSession);
const decodeContextHandoffRenderStats = Schema.decodeUnknownEffect(
  OrchestrationContextHandoffRenderStats,
);
const decodeThreadCreatedPayload = Schema.decodeUnknownEffect(ThreadCreatedPayload);
const decodeOrchestrationCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
const decodeOrchestrationEvent = Schema.decodeUnknownEffect(OrchestrationEvent);
const decodeThreadMetaUpdatedPayload = Schema.decodeUnknownEffect(ThreadMetaUpdatedPayload);

it.effect("parses turn diff input when fromTurnCount <= toTurnCount", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeTurnDiffInput({
      threadId: "thread-1",
      fromTurnCount: 1,
      toTurnCount: 2,
    });
    assert.strictEqual(parsed.fromTurnCount, 1);
    assert.strictEqual(parsed.toTurnCount, 2);
  }),
);

it.effect("rejects turn diff input when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeTurnDiffInput({
        threadId: "thread-1",
        fromTurnCount: 3,
        toTurnCount: 2,
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects thread turn diff when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeThreadTurnDiff({
        threadId: "thread-1",
        fromTurnCount: 3,
        toTurnCount: 2,
        diff: "patch",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims branded ids and command string fields at decode boundaries", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: " cmd-1 ",
      projectId: " project-1 ",
      title: " Project Title ",
      workspaceRoot: " /tmp/workspace ",
      defaultModelSelection: {
        provider: "codex",
        model: " gpt-5.2 ",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.commandId, "cmd-1");
    assert.strictEqual(parsed.projectId, "project-1");
    assert.strictEqual(parsed.title, "Project Title");
    assert.strictEqual(parsed.workspaceRoot, "/tmp/workspace");
    assert.strictEqual(parsed.createWorkspaceRootIfMissing, undefined);
    assert.deepStrictEqual(parsed.defaultModelSelection, {
      provider: "codex",
      model: "gpt-5.2",
    });
  }),
);

it.effect("decodes project.create with createWorkspaceRootIfMissing enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: "cmd-1",
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      createWorkspaceRootIfMissing: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.createWorkspaceRootIfMissing, true);
  }),
);

it.effect("decodes historical project.created payloads with a default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.provider, "codex");
  }),
);

it.effect("decodes project worktree setup profiles and apply inputs", () =>
  Effect.gen(function* () {
    const profile = yield* decodeProjectWorktreeSetupProfile({
      version: 1,
      status: "configured",
      scanFingerprint: "fingerprint-1",
      packageManager: "bun",
      framework: "vite",
      installCommand: "bun install",
      devCommand: "bun run dev",
      envStrategy: "symlink_root",
      envSourcePath: ".env",
      portCount: 5,
      storageMode: "dynamo-managed",
      autoRunSetupOnWorktreeCreate: true,
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });

    assert.strictEqual(profile.storageMode, "dynamo-managed");

    const applyInput = yield* decodeProjectApplyWorktreeSetupInput({
      projectId: "project-1",
      projectCwd: "/tmp/project",
      scanFingerprint: profile.scanFingerprint,
      installCommand: profile.installCommand,
      devCommand: profile.devCommand,
      envStrategy: profile.envStrategy,
      envSourcePath: profile.envSourcePath,
      portCount: profile.portCount,
      autoRunSetupOnWorktreeCreate: true,
    });
    assert.strictEqual(applyInput.projectId, "project-1");
  }),
);

it.effect("decodes worktree setup scan results", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectScanWorktreeSetupResult({
      configured: false,
      promptRequired: true,
      scanFingerprint: "fingerprint-1",
      detectedProjectType: "Vite",
      recommendation: {
        packageManager: "bun",
        framework: "vite",
        installCommand: "bun install",
        devCommand: "bun run dev",
        envStrategy: "none",
        envSourcePath: null,
        portCount: 5,
        confidence: "high",
      },
      runtimeHelperPreview: {
        storageMode: "dynamo-managed",
        setupDescription: "Setup helpers are stored by Dynamo.",
        devDescription: "Dev helpers are stored by Dynamo.",
      },
    });
    assert.deepStrictEqual(parsed.warnings, []);
  }),
);

it("exposes worktree setup RPC method names", () => {
  assert.strictEqual(WS_METHODS.projectsScanWorktreeSetup, "projects.scanWorktreeSetup");
  assert.strictEqual(WS_METHODS.projectsApplyWorktreeSetup, "projects.applyWorktreeSetup");
});

it.effect("decodes project.meta-updated payloads with explicit default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectMetaUpdatedPayload({
      projectId: "project-1",
      defaultModelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.provider, "claudeAgent");
  }),
);

it.effect("rejects command fields that become empty after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeProjectCreateCommand({
        type: "project.create",
        commandId: "cmd-1",
        projectId: "project-1",
        title: "  ",
        workspaceRoot: "/tmp/workspace",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes thread.turn.start defaults for provider and runtime mode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-1",
      threadId: "thread-1",
      message: {
        messageId: "msg-1",
        role: "user",
        text: "hello",
        attachments: [],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection, undefined);
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("preserves explicit provider and runtime mode in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-2",
      threadId: "thread-1",
      message: {
        messageId: "msg-2",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.provider, "codex");
    assert.strictEqual(parsed.runtimeMode, "full-access");
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("accepts bootstrap metadata in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-bootstrap",
      threadId: "thread-1",
      message: {
        messageId: "msg-bootstrap",
        role: "user",
        text: "hello",
        attachments: [],
      },
      bootstrap: {
        createThread: {
          projectId: "project-1",
          title: "Bootstrap thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        prepareWorktree: {
          projectCwd: "/tmp/workspace",
          baseBranch: "main",
          branch: "t3code/example",
        },
        runSetupScript: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.bootstrap?.createThread?.projectId, "project-1");
    assert.strictEqual(parsed.bootstrap?.prepareWorktree?.baseBranch, "main");
    assert.strictEqual(parsed.bootstrap?.runSetupScript, true);
  }),
);

it.effect("decodes thread.created runtime mode for historical events", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadCreatedPayload({
      threadId: "thread-1",
      projectId: "project-1",
      title: "Thread title",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.modelSelection.provider, "codex");
  }),
);

it.effect("decodes thread.meta-updated payloads with explicit provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadMetaUpdatedPayload({
      threadId: "thread-1",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.provider, "claudeAgent");
  }),
);

it.effect("decodes thread archive and unarchive commands", () =>
  Effect.gen(function* () {
    const archive = yield* decodeOrchestrationCommand({
      type: "thread.archive",
      commandId: "cmd-archive-1",
      threadId: "thread-1",
    });
    const unarchive = yield* decodeOrchestrationCommand({
      type: "thread.unarchive",
      commandId: "cmd-unarchive-1",
      threadId: "thread-1",
    });

    assert.strictEqual(archive.type, "thread.archive");
    assert.strictEqual(unarchive.type, "thread.unarchive");
  }),
);

it.effect("decodes thread fork command with context handoff id", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "thread.fork",
      commandId: "cmd-fork-1",
      handoffId: "handoff-fork-1",
      threadId: "thread-forked",
      projectId: "project-1",
      title: "Fork of Source",
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      forkOrigin: {
        sourceThreadId: "thread-source",
        sourceThreadTitle: "Source",
        sourceUserMessageId: "message-source-user",
        importedUntilAt: "2026-01-01T00:00:00.000Z",
        forkedAt: "2026-01-01T00:00:01.000Z",
      },
      clonedMessages: [],
      clonedProposedPlans: [],
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    assert.strictEqual(parsed.type, "thread.fork");
    assert.strictEqual(parsed.handoffId, "handoff-fork-1");
  }),
);

it.effect("decodes context handoff prepare command", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "thread.context-handoff.prepare",
      commandId: "cmd-handoff-prepare-1",
      threadId: "thread-1",
      handoffId: "handoff-provider-switch-1",
      reason: "provider-switch",
      sourceThreadId: "thread-1",
      sourceThreadTitle: "Source thread",
      sourceUserMessageId: "message-source-user",
      sourceProvider: "codex",
      targetProvider: "claudeAgent",
      importedUntilAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    assert.strictEqual(parsed.type, "thread.context-handoff.prepare");
    assert.strictEqual(parsed.reason, "provider-switch");
    assert.strictEqual(parsed.targetProvider, "claudeAgent");
  }),
);

it.effect("decodes thread archived and unarchived events", () =>
  Effect.gen(function* () {
    const archived = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-archive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.archived",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-archive-1",
      causationEventId: null,
      correlationId: "cmd-archive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        archivedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const unarchived = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "event-unarchive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.unarchived",
      occurredAt: "2026-01-02T00:00:00.000Z",
      commandId: "cmd-unarchive-1",
      causationEventId: null,
      correlationId: "cmd-unarchive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });

    assert.strictEqual(archived.type, "thread.archived");
    assert.strictEqual(archived.payload.archivedAt, "2026-01-01T00:00:00.000Z");
    assert.strictEqual(unarchived.type, "thread.unarchived");
  }),
);

it.effect("decodes context handoff events", () =>
  Effect.gen(function* () {
    const renderStats = yield* decodeContextHandoffRenderStats({
      includedMessageCount: 2,
      includedProposedPlanCount: 1,
      includedAttachmentCount: 1,
      omittedItemCount: 0,
      truncated: false,
      inputCharCount: 1200,
    });

    const eventBase = {
      sequence: 1,
      eventId: "event-handoff-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-handoff-1",
      causationEventId: null,
      correlationId: "cmd-handoff-1",
      metadata: {},
    } as const;

    const prepared = yield* decodeOrchestrationEvent({
      ...eventBase,
      type: "thread.context-handoff-prepared",
      payload: {
        handoffId: "handoff-1",
        threadId: "thread-1",
        reason: "fork",
        sourceThreadId: "thread-source",
        sourceThreadTitle: "Source",
        sourceUserMessageId: "message-source-user",
        targetProvider: "codex",
        importedUntilAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const delivered = yield* decodeOrchestrationEvent({
      ...eventBase,
      sequence: 2,
      eventId: "event-handoff-2",
      type: "thread.context-handoff-delivered",
      payload: {
        handoffId: "handoff-1",
        threadId: "thread-1",
        liveMessageId: "message-live",
        provider: "codex",
        turnId: "turn-1",
        renderStats,
        deliveredAt: "2026-01-01T00:00:01.000Z",
      },
    });
    const failed = yield* decodeOrchestrationEvent({
      ...eventBase,
      sequence: 3,
      eventId: "event-handoff-3",
      type: "thread.context-handoff-delivery-failed",
      payload: {
        handoffId: "handoff-1",
        threadId: "thread-1",
        liveMessageId: "message-live",
        provider: "codex",
        detail: "Provider failed",
        renderStats,
        failedAt: "2026-01-01T00:00:02.000Z",
      },
    });

    assert.strictEqual(prepared.type, "thread.context-handoff-prepared");
    assert.strictEqual(delivered.type, "thread.context-handoff-delivered");
    assert.strictEqual(failed.type, "thread.context-handoff-delivery-failed");
  }),
);

it.effect("defaults context handoffs on decoded read models", () =>
  Effect.gen(function* () {
    const thread = {
      id: "thread-1",
      projectId: "project-1",
      title: "Thread",
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    };

    const readModel = yield* decodeOrchestrationReadModel({
      snapshotSequence: 1,
      projects: [],
      threads: [thread],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const shellSnapshot = yield* decodeOrchestrationShellSnapshot({
      snapshotSequence: 1,
      projects: [],
      threads: [
        {
          ...thread,
          latestUserMessageAt: null,
          hasPendingApprovals: false,
          hasPendingUserInput: false,
          hasActionableProposedPlan: false,
          session: null,
        },
      ],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.deepStrictEqual(readModel.threads[0]?.contextHandoffs, []);
    assert.deepStrictEqual(shellSnapshot.threads[0]?.contextHandoffs, []);
  }),
);

it.effect("accepts provider-scoped model options in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-options",
      threadId: "thread-1",
      message: {
        messageId: "msg-options",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: {
          reasoningEffort: "high",
          fastMode: true,
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.provider, "codex");
    assert.strictEqual(parsed.modelSelection?.options?.reasoningEffort, "high");
    assert.strictEqual(parsed.modelSelection?.options?.fastMode, true);
  }),
);

it.effect("accepts a title seed in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-title-seed",
      threadId: "thread-1",
      message: {
        messageId: "msg-title-seed",
        role: "user",
        text: "hello",
        attachments: [],
      },
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("accepts a source proposed plan reference in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-source-plan",
      threadId: "thread-2",
      message: {
        messageId: "msg-source-plan",
        role: "user",
        text: "implement this",
        attachments: [],
      },
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect(
  "decodes thread.turn-start-requested defaults for provider, runtime mode, and interaction mode",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeThreadTurnStartRequestedPayload({
        threadId: "thread-1",
        messageId: "msg-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      assert.strictEqual(parsed.modelSelection, undefined);
      assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
      assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
      assert.strictEqual(parsed.sourceProposedPlan, undefined);
    }),
);

it.effect("decodes thread.turn-start-requested source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes thread.turn-start-requested title seed when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("decodes latest turn source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationLatestTurn({
      turnId: "turn-2",
      state: "running",
      requestedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: null,
      assistantMessageId: null,
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes orchestration session runtime mode defaults", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSession({
      threadId: "thread-1",
      status: "idle",
      providerName: null,
      providerSessionId: null,
      providerThreadId: null,
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
  }),
);

it.effect("defaults proposed plan implementation metadata for historical rows", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-1",
      turnId: "turn-1",
      planMarkdown: "# Plan",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, null);
    assert.strictEqual(parsed.implementationThreadId, null);
  }),
);

it.effect("preserves proposed plan implementation metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-2",
      turnId: "turn-2",
      planMarkdown: "# Plan",
      implementedAt: "2026-01-02T00:00:00.000Z",
      implementationThreadId: "thread-2",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, "2026-01-02T00:00:00.000Z");
    assert.strictEqual(parsed.implementationThreadId, "thread-2");
  }),
);
