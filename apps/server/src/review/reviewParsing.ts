import {
  ReviewFinding,
  type ReviewFinding as ReviewFindingType,
  type ReviewStepKind,
  type TeamTaskId,
} from "@t3tools/contracts";
import { Schema } from "effect";

const decodeFinding = Schema.decodeUnknownOption(ReviewFinding);

function stripCodeFence(text: string): string {
  const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return match?.[1]?.trim() ?? text.trim();
}

function extractTagged(text: string, tag: "findings" | "verification"): string | null {
  const match = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i").exec(text);
  return match?.[1]?.trim() ?? null;
}

function extractJsonCandidate(text: string): unknown {
  const trimmed = stripCodeFence(text);
  try {
    return JSON.parse(trimmed);
  } catch {
    const arrayStart = trimmed.indexOf("[");
    const arrayEnd = trimmed.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
    }
    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
    }
    throw new Error("No JSON object or array found.");
  }
}

function stableFindingId(input: {
  readonly sourceTaskId?: TeamTaskId;
  readonly file: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly kind: string;
  readonly summary: string;
}): string {
  const raw = `${input.sourceTaskId ?? "review"}:${input.file}:${input.lineStart}:${input.lineEnd}:${input.kind}:${input.summary}`;
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) | 0;
  }
  return `review-finding:${Math.abs(hash).toString(36)}`;
}

export function parseReviewFindings(input: {
  readonly text: string | null;
  readonly sourceStep: ReviewStepKind;
  readonly sourceTaskId?: TeamTaskId;
}): ReadonlyArray<ReviewFindingType> {
  if (!input.text?.trim()) return [];
  const tagged = extractTagged(input.text, "findings");
  const parsed = extractJsonCandidate(tagged ?? input.text);
  const rows: ReadonlyArray<unknown> = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as any).findings)
      ? (parsed as any).findings
      : [];

  return rows.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const record = row as Record<string, unknown>;
    const file = typeof record.file === "string" ? record.file.trim() : "";
    const lineStart = Number(record.lineStart);
    const lineEnd = Number(record.lineEnd);
    const kind = typeof record.kind === "string" ? record.kind.trim() : input.sourceStep;
    const summary = typeof record.summary === "string" ? record.summary.trim() : "";
    if (!file || !summary || !Number.isInteger(lineStart) || lineStart <= 0) return [];
    const normalized = {
      id: stableFindingId({
        ...(input.sourceTaskId !== undefined ? { sourceTaskId: input.sourceTaskId } : {}),
        file,
        lineStart,
        lineEnd: Number.isInteger(lineEnd) && lineEnd >= lineStart ? lineEnd : lineStart,
        kind,
        summary,
      }),
      file,
      lineStart,
      lineEnd: Number.isInteger(lineEnd) && lineEnd >= lineStart ? lineEnd : lineStart,
      severity:
        record.severity === "high" || record.severity === "medium" || record.severity === "low"
          ? record.severity
          : "medium",
      kind,
      summary,
      ...(typeof record.reasoning === "string" ? { reasoning: record.reasoning } : {}),
      ...(typeof record.evidence === "string" ? { evidence: record.evidence } : {}),
      sourceStep: input.sourceStep,
      ...(input.sourceTaskId !== undefined ? { sourceTaskId: input.sourceTaskId } : {}),
      verified: false,
      verifier: null,
    };
    const decoded = decodeFinding(normalized);
    return decoded._tag === "Some" ? [decoded.value] : [];
  });
}

export function parseVerification(text: string | null): {
  readonly reproduced: boolean;
  readonly evidence: string;
} {
  if (!text?.trim()) return { reproduced: false, evidence: "" };
  try {
    const tagged = extractTagged(text, "verification");
    const parsed = extractJsonCandidate(tagged ?? text);
    if (typeof parsed !== "object" || parsed === null) {
      return { reproduced: false, evidence: text.trim().slice(0, 2_000) };
    }
    const record = parsed as Record<string, unknown>;
    return {
      reproduced: record.reproduced === true,
      evidence:
        typeof record.evidence === "string"
          ? record.evidence.trim().slice(0, 4_000)
          : text.trim().slice(0, 2_000),
    };
  } catch {
    return { reproduced: false, evidence: text.trim().slice(0, 2_000) };
  }
}

export function dedupeFindings(
  findings: ReadonlyArray<ReviewFindingType>,
): ReadonlyArray<ReviewFindingType> {
  const byKey = new Map<string, ReviewFindingType>();
  const severityRank = { high: 3, medium: 2, low: 1 } as const;
  for (const finding of findings) {
    const key = `${finding.file}:${finding.lineStart}:${finding.lineEnd}:${finding.kind.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || severityRank[finding.severity] > severityRank[existing.severity]) {
      byKey.set(key, finding);
    }
  }
  return [...byKey.values()].toSorted(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.lineStart - right.lineStart ||
      left.kind.localeCompare(right.kind),
  );
}
