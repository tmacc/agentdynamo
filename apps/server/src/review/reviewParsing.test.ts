import { TeamTaskId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { dedupeFindings, parseReviewFindings, parseVerification } from "./reviewParsing.ts";

describe("reviewParsing", () => {
  it("parses tagged Anthropic findings and normalizes defaults", () => {
    const findings = parseReviewFindings({
      sourceStep: "bug-hunt",
      sourceTaskId: TeamTaskId.make("task-1"),
      text: `<findings>
        [
          {
            "file": "src/user.ts",
            "lineStart": 42,
            "lineEnd": 40,
            "kind": "null-deref",
            "summary": "User lookup can return null before dereference."
          }
        ]
      </findings>`,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: "src/user.ts",
      lineStart: 42,
      lineEnd: 42,
      severity: "medium",
      sourceStep: "bug-hunt",
      verified: false,
    });
  });

  it("dedupes findings by file, line range, and kind while keeping higher severity", () => {
    const findings = parseReviewFindings({
      sourceStep: "style",
      text: JSON.stringify([
        {
          file: "src/a.ts",
          lineStart: 10,
          lineEnd: 10,
          severity: "low",
          kind: "style",
          summary: "Low confidence.",
        },
        {
          file: "src/a.ts",
          lineStart: 10,
          lineEnd: 10,
          severity: "high",
          kind: "style",
          summary: "High confidence.",
        },
      ]),
    });

    expect(dedupeFindings(findings)).toHaveLength(1);
    expect(dedupeFindings(findings)[0]?.severity).toBe("high");
  });

  it("requires explicit reproduced true in verifier output", () => {
    expect(parseVerification(`{"reproduced": true, "evidence": "exit code 1"}`)).toEqual({
      reproduced: true,
      evidence: "exit code 1",
    });
    expect(parseVerification(`{"reproduced": false, "evidence": "exit code 0"}`).reproduced).toBe(
      false,
    );
  });
});
