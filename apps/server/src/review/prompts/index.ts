import type { ReviewFinding, ReviewStep } from "@t3tools/contracts";

import type { ReviewStepContext } from "../reviewContext.ts";

function jsonShape() {
  return `{ "file": string, "lineStart": number, "lineEnd": number, "severity": "high"|"medium"|"low", "kind": string, "summary": string, "reasoning": string }`;
}

function claudeMdText(ctx: ReviewStepContext): string {
  if (ctx.claudeMdFragments.length === 0) return "No CLAUDE.md files found for changed paths.";
  return ctx.claudeMdFragments
    .map((fragment) => `--- ${fragment.path} ---\n${fragment.text}`)
    .join("\n\n");
}

function prMeta(ctx: ReviewStepContext): string {
  if (!ctx.pr) return `PR reference: ${ctx.prRef}`;
  return `PR #${ctx.pr.number}: ${ctx.pr.title}\n${ctx.pr.headRefName} -> ${ctx.pr.baseRefName}\n${ctx.pr.url}`;
}

function stepTask(step: ReviewStep): string {
  switch (step.kind) {
    case "map":
      return "Map the changed code and report only high-risk review targets that are concrete enough to verify.";
    case "bug-hunt":
      return "Find correctness, logic, race, state, and security bugs introduced by this PR.";
    case "style":
      return "Find newly introduced violations of CLAUDE.md or local repository conventions.";
    case "verify":
      return "Verify review findings.";
  }
}

function highSignalRules() {
  return [
    "Return only findings that are significant and actionable.",
    "Do not report formatting nits, subjective style, or issues a linter would catch.",
    "Do not report pre-existing issues unless this PR makes them worse.",
    "Every finding must point at a changed file and specific line range.",
    "If you are not certain the issue is real, omit it.",
  ].join("\n");
}

export function renderReviewStepPrompt(step: ReviewStep, ctx: ReviewStepContext): string {
  if (step.promptFlavor === "anthropic") {
    return `<task>${stepTask(step)}</task>

<pr_meta>
${prMeta(ctx)}
</pr_meta>

<changed_files>
${ctx.changedFiles.join("\n") || "(none)"}
</changed_files>

<claude_md_constraints>
${claudeMdText(ctx)}
</claude_md_constraints>

<diff>
${ctx.diff}
</diff>

<instructions>
Think carefully before producing findings.
${highSignalRules()}
</instructions>

<output_format>
Return ONLY a JSON array wrapped in <findings>...</findings>.
Each item shape: ${jsonShape()}
If there are no findings, return <findings>[]</findings>.
</output_format>`;
  }

  return `SYSTEM: You are a senior reviewer. Be terse. No prose outside JSON.

Task: ${stepTask(step)}

${prMeta(ctx)}

Changed files:
${ctx.changedFiles.join("\n") || "(none)"}

CLAUDE.md constraints for changed paths:
${claudeMdText(ctx)}

Diff:
${ctx.diff}

Rules:
${highSignalRules()}

Output a single JSON array. Each item shape: ${jsonShape()}
If there are no findings, return [].`;
}

export function renderVerifyPrompt(input: {
  readonly finding: ReviewFinding;
  readonly ctx: ReviewStepContext;
  readonly flavor: "anthropic" | "openai";
  readonly singleProviderMode: boolean;
}): string {
  const findingJson = JSON.stringify(
    {
      file: input.finding.file,
      lineStart: input.finding.lineStart,
      lineEnd: input.finding.lineEnd,
      severity: input.finding.severity,
      kind: input.finding.kind,
      summary: input.finding.summary,
      reasoning: input.finding.reasoning ?? "",
    },
    null,
    2,
  );
  const independenceRule = input.singleProviderMode
    ? "You are a fresh-context verifier. Treat the original reviewer skeptically. In single-provider mode, only return reproduced=true if a concrete command, test, or static trace proves the finding."
    : "You are an independent cross-provider verifier. Treat the original reviewer skeptically.";

  if (input.flavor === "anthropic") {
    return `<task>Verify whether a review finding is real.</task>

<finding>
${findingJson}
</finding>

<pr_meta>
${prMeta(input.ctx)}
</pr_meta>

<diff>
${input.ctx.diff}
</diff>

<instructions>
${independenceRule}
Write or identify the smallest concrete reproduction you can.
Run the relevant test, typecheck, lint, or static command when possible.
Do not fix the bug.
Return reproduced=false if you cannot reproduce or prove it.
</instructions>

<output_format>
Return ONLY <verification>{"reproduced": boolean, "evidence": string, "command": string|null, "exitCode": number|null}</verification>.
</output_format>`;
  }

  return `SYSTEM: Verify a code review finding. No prose outside JSON.

${independenceRule}
Do not fix the bug. Only add temporary tests if needed for reproduction.
Run a concrete command when possible. Return reproduced=false if unproven.

Finding:
${findingJson}

${prMeta(input.ctx)}

Diff:
${input.ctx.diff}

Output exactly:
{ "reproduced": boolean, "evidence": string, "command": string|null, "exitCode": number|null }`;
}
