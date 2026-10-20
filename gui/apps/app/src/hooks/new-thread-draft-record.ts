import type { PromptDraftState } from "@cloudroom/client-core";
import { parsePromptDraftStorage } from "@cloudroom/client-core";

export type NewThreadDraftRecord =
  | { kind: "missing" }
  | { kind: "draft"; rev?: string; draft: PromptDraftState }
  | { kind: "sent"; rev: string }
  | { kind: "moved"; rev: string; leftover?: PromptDraftState }
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
      if (typeof rev !== "string") return { kind: "unreadable" };
      const keys = Object.keys(record).filter((key) => key !== "base");
      if (keys.length === 2) return { kind, rev };
      if (kind !== "moved") return { kind: "unreadable" };
      const { moved: _moved, ...rest } = record;
      const leftover = readDraftFields(rest, JSON.stringify(rest));
      return leftover ? { kind, rev, leftover } : { kind: "unreadable" };
    }
  }

  const draft = readDraftFields(record, rawValue);
  if (!draft) return { kind: "unreadable" };
  return { kind: "draft", ...(typeof rev === "string" ? { rev } : {}), draft };
}

function readDraftFields(record: Record<string, unknown>, rawValue: string): PromptDraftState | null {
  if (Object.keys(record).some((key) => !DRAFT_FIELDS.has(key))) {
    return null;
  }
  if (record.text !== undefined && typeof record.text !== "string") {
    return null;
  }
  if (
    ["mentions", "attachments", "contexts"].some(
      (field) => record[field] !== undefined && !Array.isArray(record[field]),
    )
  ) {
    return null;
  }
  const draft = parsePromptDraftStorage(rawValue);
  if (
    draft.mentions.length !== arrayLength(record.mentions) ||
    draft.attachments.length !== arrayLength(record.attachments) ||
    (draft.contexts?.length ?? 0) !== arrayLength(record.contexts)
  ) {
    return null;
  }
  return draft;
}
