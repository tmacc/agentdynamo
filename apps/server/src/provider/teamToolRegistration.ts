import type { ProviderSessionStartInput } from "@t3tools/contracts";

export const CODEX_TEAM_MCP_SERVER_NAME = "t3_team" as const;

export function buildClaudeTeamToolRegistration(
  teamCoordinator: NonNullable<ProviderSessionStartInput["teamCoordinator"]>,
): Record<string, string> {
  return {
    "mcp-config": JSON.stringify({
      mcpServers: {
        [CODEX_TEAM_MCP_SERVER_NAME]: {
          type: "http",
          url: teamCoordinator.mcpServerUrl,
          headers: {
            Authorization: `Bearer ${teamCoordinator.accessToken}`,
          },
        },
      },
    }),
  };
}

export function buildCodexTeamToolRegistration(input: {
  readonly teamCoordinator: NonNullable<ProviderSessionStartInput["teamCoordinator"]>;
  readonly accessTokenEnvVar: string;
}): {
  readonly configOverrides: ReadonlyArray<string>;
  readonly env: Record<string, string>;
  readonly serverName: string;
  readonly serverUrl: string;
} {
  return {
    configOverrides: [
      `mcp_servers.${CODEX_TEAM_MCP_SERVER_NAME}.url="${input.teamCoordinator.mcpServerUrl}"`,
      `mcp_servers.${CODEX_TEAM_MCP_SERVER_NAME}.bearer_token_env_var="${input.accessTokenEnvVar}"`,
    ],
    env: {
      [input.accessTokenEnvVar]: input.teamCoordinator.accessToken,
    },
    serverName: CODEX_TEAM_MCP_SERVER_NAME,
    serverUrl: input.teamCoordinator.mcpServerUrl,
  };
}
