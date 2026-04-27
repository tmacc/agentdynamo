import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, expect, vi } from "vitest";

vi.mock("../../processRunner", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../processRunner.ts";
import { GitHubCli } from "../Services/GitHubCli.ts";
import { GitHubCliLive } from "./GitHubCli.ts";

const mockedRunProcess = vi.mocked(runProcess);
const layer = it.layer(GitHubCliLive);

afterEach(() => {
  mockedRunProcess.mockReset();
});

layer("GitHubCliLive", (it) => {
  it.effect("parses pull request view output", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          number: 42,
          title: "Add PR thread creation",
          url: "https://github.com/example/project/pull/42",
          baseRefName: "main",
          headRefName: "feature/pr-threads",
          state: "OPEN",
          mergedAt: null,
          isCrossRepository: true,
          headRepository: {
            nameWithOwner: "octocat/project",
          },
          headRepositoryOwner: {
            login: "octocat",
          },
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getPullRequest({
          cwd: "/repo",
          reference: "#42",
        });
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/example/project/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/project",
        headRepositoryOwnerLogin: "octocat",
      });
      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        [
          "pr",
          "view",
          "#42",
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("trims pull request fields decoded from gh json", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          number: 42,
          title: "  Add PR thread creation  \n",
          url: " https://github.com/example/project/pull/42 ",
          baseRefName: " main ",
          headRefName: "\tfeature/pr-threads\t",
          state: "OPEN",
          mergedAt: null,
          isCrossRepository: true,
          headRepository: {
            nameWithOwner: " octocat/project ",
          },
          headRepositoryOwner: {
            login: " octocat ",
          },
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getPullRequest({
          cwd: "/repo",
          reference: "#42",
        });
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/example/project/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/project",
        headRepositoryOwnerLogin: "octocat",
      });
    }),
  );

  it.effect("skips invalid entries when parsing pr lists", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            number: 0,
            title: "invalid",
            url: "https://github.com/example/project/pull/0",
            baseRefName: "main",
            headRefName: "feature/invalid",
          },
          {
            number: 43,
            title: "  Valid PR  ",
            url: " https://github.com/example/project/pull/43 ",
            baseRefName: " main ",
            headRefName: " feature/pr-list ",
            headRepository: {
              nameWithOwner: "   ",
            },
            headRepositoryOwner: {
              login: "   ",
            },
          },
        ]),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.listOpenPullRequests({
          cwd: "/repo",
          headSelector: "feature/pr-list",
        });
      });

      assert.deepStrictEqual(result, [
        {
          number: 43,
          title: "Valid PR",
          url: "https://github.com/example/project/pull/43",
          baseRefName: "main",
          headRefName: "feature/pr-list",
          state: "open",
        },
      ]);
    }),
  );

  it.effect(
    "keeps same-repository PR list entries when gh omits headRepository.nameWithOwner",
    () =>
      Effect.gen(function* () {
        mockedRunProcess.mockResolvedValueOnce({
          stdout: JSON.stringify([
            {
              number: 18,
              title: "Restore fork features",
              url: "https://github.com/tmacc/agentdynamo/pull/18",
              baseRefName: "main",
              headRefName: "t3code/apply-requested-patch",
              state: "OPEN",
              isCrossRepository: false,
              headRepository: {
                id: "R_kgDOSDwZ9A",
                name: "agentdynamo",
              },
              headRepositoryOwner: {
                login: "tmacc",
              },
            },
          ]),
          stderr: "",
          code: 0,
          signal: null,
          timedOut: false,
        });

        const result = yield* Effect.gen(function* () {
          const gh = yield* GitHubCli;
          return yield* gh.listOpenPullRequests({
            cwd: "/repo",
            headSelector: "t3code/apply-requested-patch",
            repository: "tmacc/agentdynamo",
          });
        });

        assert.deepStrictEqual(result, [
          {
            number: 18,
            title: "Restore fork features",
            url: "https://github.com/tmacc/agentdynamo/pull/18",
            baseRefName: "main",
            headRefName: "t3code/apply-requested-patch",
            state: "open",
            isCrossRepository: false,
            headRepositoryOwnerLogin: "tmacc",
          },
        ]);
      }),
  );

  it.effect("reads repository clone URLs", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          nameWithOwner: "octocat/project",
          url: "https://github.com/octocat/project",
          sshUrl: "git@github.com:octocat/project.git",
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getRepositoryCloneUrls({
          cwd: "/repo",
          repository: "octocat/project",
        });
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/project",
        url: "https://github.com/octocat/project",
        sshUrl: "git@github.com:octocat/project.git",
      });
    }),
  );

  it.effect("surfaces a friendly error when the pull request is not found", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockRejectedValueOnce(
        new Error(
          "GraphQL: Could not resolve to a PullRequest with the number of 4888. (repository.pullRequest)",
        ),
      );

      const error = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getPullRequest({
          cwd: "/repo",
          reference: "4888",
        });
      }).pipe(Effect.flip);

      assert.equal(error.message.includes("Pull request not found"), true);
    }),
  );
});
