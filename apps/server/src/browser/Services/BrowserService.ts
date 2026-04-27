import type {
  BrowserExperienceResult,
  BrowserGraphEdge,
  BrowserGraphNode,
  BrowserLeaseId,
  BrowserSession,
  ThreadId,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface BrowserSnapshotResult {
  readonly session: BrowserSession;
  readonly nodes: ReadonlyArray<BrowserGraphNode>;
  readonly edges: ReadonlyArray<BrowserGraphEdge>;
  readonly summary: string;
  readonly consoleErrors: ReadonlyArray<string>;
  readonly failedRequests: ReadonlyArray<string>;
}

export interface BrowserScreenshotResult {
  readonly session: BrowserSession;
  readonly artifactId: string;
  readonly path: string;
}

export interface BrowserExperienceInput {
  readonly threadId: ThreadId;
  readonly target: string;
  readonly persona?: string;
  readonly goal?: string;
  readonly mode?: string;
  readonly budget?: {
    readonly maxMinutes?: number;
    readonly maxBranches?: number;
    readonly viewports?: ReadonlyArray<string>;
  };
}

export interface BrowserServiceShape {
  readonly open: (input: {
    readonly threadId: ThreadId;
    readonly url: string;
    readonly leaseId?: BrowserLeaseId;
  }) => Effect.Effect<BrowserSnapshotResult, Error>;
  readonly snapshot: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<BrowserSnapshotResult, Error>;
  readonly screenshot: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<BrowserScreenshotResult, Error>;
  readonly experience: (
    input: BrowserExperienceInput,
  ) => Effect.Effect<BrowserExperienceResult, Error>;
  readonly reset: (input: { readonly threadId: ThreadId }) => Effect.Effect<BrowserSession, Error>;
  readonly close: (input: { readonly threadId: ThreadId }) => Effect.Effect<void, Error>;
  readonly closeAll: Effect.Effect<void>;
}

export class BrowserService extends Context.Service<BrowserService, BrowserServiceShape>()(
  "t3/browser/Services/BrowserService",
) {}
