import type {
  BoardListCardsResult,
  BoardListDismissedGhostsResult,
  EnvironmentId,
  EnvironmentApi,
} from "@t3tools/contracts";

import type { WsRpcClient } from "./rpc/wsRpcClient";
import { readEnvironmentConnection } from "./environments/runtime";

const environmentApiOverridesForTests = new Map<EnvironmentId, EnvironmentApi>();

export function createEnvironmentApi(rpcClient: WsRpcClient): EnvironmentApi {
  return {
    terminal: {
      open: (input) => rpcClient.terminal.open(input as never),
      write: (input) => rpcClient.terminal.write(input as never),
      resize: (input) => rpcClient.terminal.resize(input as never),
      clear: (input) => rpcClient.terminal.clear(input as never),
      restart: (input) => rpcClient.terminal.restart(input as never),
      close: (input) => rpcClient.terminal.close(input as never),
      onEvent: (callback) => rpcClient.terminal.onEvent(callback),
    },
    projects: {
      searchEntries: rpcClient.projects.searchEntries,
      writeFile: rpcClient.projects.writeFile,
      scanWorktreeSetup: rpcClient.projects.scanWorktreeSetup,
      applyWorktreeSetup: rpcClient.projects.applyWorktreeSetup,
      getIntelligence: rpcClient.projects.getIntelligence,
      readIntelligenceSurface: rpcClient.projects.readIntelligenceSurface,
      getSurfaceOverrides: rpcClient.projects.getSurfaceOverrides,
      setSurfaceEnabled: rpcClient.projects.setSurfaceEnabled,
    },
    filesystem: {
      browse: rpcClient.filesystem.browse,
    },
    sourceControl: {
      lookupRepository: rpcClient.sourceControl.lookupRepository,
      cloneRepository: rpcClient.sourceControl.cloneRepository,
      publishRepository: rpcClient.sourceControl.publishRepository,
    },
    vcs: {
      pull: rpcClient.vcs.pull,
      refreshStatus: rpcClient.vcs.refreshStatus,
      onStatus: (input, callback, options) => rpcClient.vcs.onStatus(input, callback, options),
      listRefs: rpcClient.vcs.listRefs,
      createWorktree: rpcClient.vcs.createWorktree,
      removeWorktree: rpcClient.vcs.removeWorktree,
      createRef: rpcClient.vcs.createRef,
      switchRef: rpcClient.vcs.switchRef,
      init: rpcClient.vcs.init,
    },
    git: {
      previewWorktreePatch: rpcClient.git.previewWorktreePatch,
      applyWorktreePatch: rpcClient.git.applyWorktreePatch,
      resolvePullRequest: rpcClient.git.resolvePullRequest,
      getPullRequestRemoteOptions: rpcClient.git.getPullRequestRemoteOptions,
      setPullRequestRemote: rpcClient.git.setPullRequestRemote,
      preparePullRequestThread: rpcClient.git.preparePullRequestThread,
    },
    orchestration: {
      dispatchCommand: rpcClient.orchestration.dispatchCommand,
      forkThread: rpcClient.orchestration.forkThread,
      getTurnDiff: rpcClient.orchestration.getTurnDiff,
      getFullThreadDiff: rpcClient.orchestration.getFullThreadDiff,
      getTeamTaskTrace: rpcClient.orchestration.getTeamTaskTrace,
      getArchivedShellSnapshot: rpcClient.orchestration.getArchivedShellSnapshot,
      subscribeShell: (callback, options) =>
        rpcClient.orchestration.subscribeShell(callback, options),
      subscribeThread: (input, callback, options) =>
        rpcClient.orchestration.subscribeThread(input, callback, options),
      subscribeTeamTaskTrace: (input, callback, options) =>
        rpcClient.orchestration.subscribeTeamTaskTrace(input, callback, options),
    },
    board: {
      listCards: (input) => rpcClient.board.listCards(input) as Promise<BoardListCardsResult>,
      listDismissedGhosts: (input) =>
        rpcClient.board.listDismissedGhosts(input) as Promise<BoardListDismissedGhostsResult>,
      subscribeProject: (input, callback, options) =>
        rpcClient.board.subscribeProject(input, callback, options),
      dispatchCommand: (command) => rpcClient.orchestration.dispatchCommand(command as never),
    },
  };
}

export function readEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!environmentId) {
    return undefined;
  }

  const overriddenApi = environmentApiOverridesForTests.get(environmentId);
  if (overriddenApi) {
    return overriddenApi;
  }

  const connection = readEnvironmentConnection(environmentId);
  return connection ? createEnvironmentApi(connection.client) : undefined;
}

export function ensureEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi {
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }
  return api;
}

export function __setEnvironmentApiOverrideForTests(
  environmentId: EnvironmentId,
  api: EnvironmentApi,
): void {
  environmentApiOverridesForTests.set(environmentId, api);
}

export function __resetEnvironmentApiOverridesForTests(): void {
  environmentApiOverridesForTests.clear();
}
