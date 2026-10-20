import type { PromptDraftState } from "@cloudroom/client-core";
import { parsePromptDraftStorage } from "@cloudroom/client-core";

export type NewThreadDraftRecord =
  | { kind: "missing" }
  | { kind: "draft"; rev?: string; draft: PromptDraftState }
  | { kind: "sent"; rev: string }
  | { kind: "moved"; rev: string }
  | { kind: "discarded"; rev: string }
  | { kind: "unreadable" };

const DRAFT_FIELDS = new Set(["text", "mentions", "attachments", "contexts", "rev", "base"]);
const MARKER_KINDS = ["sent", "moved", "discarded"] as const;
const REV_PATTERN = /^[0-9a-f]{16}$/;

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function readNewThreadRecord(rawValue: string | null): NewThreadDraftRecord {
  if (rawValue === null) return { kind: "missing" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return { kind: "unreadable" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "unreadable" };
  }
  const record = parsed as Record<string, unknown>;
  const rev = record.rev;
  if (rev !== undefined && (typeof rev !== "string" || !REV_PATTERN.test(rev))) {
    return { kind: "unreadable" };
  }

  for (const kind of MARKER_KINDS) {
    if (record[kind] === true) {
      const keys = Object.keys(record).filter((key) => key !== "base");
      return typeof rev === "string" && keys.length === 2
        ? { kind, rev }
        : { kind: "unreadable" };
    }
  }

  if (Object.keys(record).some((key) => !DRAFT_FIELDS.has(key))) {
    return { kind: "unreadable" };
  }
  if (record.text !== undefined && typeof record.text !== "string") {
    return { kind: "unreadable" };
  }
  const draft = parsePromptDraftStorage(rawValue);
  if (
    draft.mentions.length !== arrayLength(record.mentions) ||
    draft.attachments.length !== arrayLength(record.attachments) ||
    (draft.contexts?.length ?? 0) !== arrayLength(record.contexts)
  ) {
    return { kind: "unreadable" };
  }
  return { kind: "draft", ...(typeof rev === "string" ? { rev } : {}), draft };
}
