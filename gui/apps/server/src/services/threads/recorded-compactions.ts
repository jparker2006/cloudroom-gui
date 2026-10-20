import { createHash } from "node:crypto";
import {
  getActiveStoredTurnId,
  listRecordedCompactionEventRows,
  type DbConnection,
  type StoredEventRow,
} from "@cloudroom/db";
import {
  THREAD_CONTEXT_CLEAR_OPERATION,
  THREAD_IMPORT_OPERATION,
  type Thread,
} from "@cloudroom/domain";
import type {
  RecordedCompactionEntry,
  RecordedCompactionGap,
  RecordedCompactionsList,
  RecordedCompactionsSummary,
} from "@cloudroom/server-contract";

export const RECORDED_COMPACTIONS_LIST_LIMIT = 50;

interface CompactionState {
  id: string;
  turnId: string | null;
  sequence: number;
  startedAt: number | null;
  completedAt: number | null;
  confirmed: boolean;
}

function parseData(row: StoredEventRow): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(row.data);
    return value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function threadGaps(
  thread: Thread,
  providerReportsCompactions: boolean,
): RecordedCompactionGap[] {
  const gaps: RecordedCompactionGap[] = [];
  if (thread.originKind === "fork") gaps.push("forked");
  if (thread.executionTarget === "cloud") gaps.push("cloud-auto-not-reported");
  if (!providerReportsCompactions) gaps.push("provider-unverified");
  return gaps;
}

function pairLateItemsWithMarkers(
  compactions: CompactionState[],
  gaps: Set<RecordedCompactionGap>,
): void {
  const turns = new Set(compactions.map((compaction) => compaction.turnId));
  for (const turnId of turns) {
    const inTurn = compactions.filter((c) => c.turnId === turnId);
    const markers = inTurn.filter((c) => c.id.startsWith("marker:"));
    const items = inTurn.filter(
      (c) => !c.confirmed && !c.id.startsWith("marker:"),
    );
    if (markers.length === 0 || items.length === 0) continue;
    if (markers.length !== 1 || items.length !== 1) {
      gaps.add("ambiguous-legacy");
      continue;
    }
    const [marker] = markers;
    const [item] = items;
    item.confirmed = true;
    item.completedAt = marker.completedAt;
    item.sequence = Math.min(item.sequence, marker.sequence);
    compactions.splice(compactions.indexOf(marker), 1);
  }
}

export function buildRecordedCompactions(
  db: DbConnection,
  thread: Thread,
  sequenceEnd: number,
  providerReportsCompactions: boolean,
): RecordedCompactionsList {
  const rows = listRecordedCompactionEventRows(db, {
    threadId: thread.id,
    sequenceEnd,
  });
  const gaps = new Set<RecordedCompactionGap>(
    threadGaps(thread, providerReportsCompactions),
  );
  const compactions: CompactionState[] = [];
  const byItemId = new Map<string, CompactionState>();
  const clears: Array<{ id: string; at: number; sequence: number }> = [];

  const compactionForItem = (row: StoredEventRow, itemId: string) => {
    const existing = byItemId.get(itemId);
    if (existing) return existing;
    const created: CompactionState = {
      id: itemId,
      turnId: row.turnId,
      sequence: row.sequence,
      startedAt: null,
      completedAt: null,
      confirmed: false,
    };
    byItemId.set(itemId, created);
    compactions.push(created);
    return created;
  };

  for (const row of rows) {
    const data = parseData(row);
    if (row.type === "item/started" && row.itemId) {
      const compaction = compactionForItem(row, row.itemId);
      compaction.startedAt ??= row.createdAt;
      continue;
    }
    if (row.type === "item/completed" && row.itemId) {
      compactionForItem(row, row.itemId);
      continue;
    }
    if (row.type === "thread/compacted") {
      const itemId = typeof data.itemId === "string" ? data.itemId : null;
      let target: CompactionState | undefined;
      if (itemId !== null) {
        target = compactionForItem(row, itemId);
      } else {
        const sameTurn = compactions.filter(
          (compaction) => compaction.turnId === row.turnId,
        );
        const unconfirmed = sameTurn.filter((c) => !c.confirmed);
        if (unconfirmed.length === 1) {
          target = unconfirmed[0];
        } else if (unconfirmed.length > 1) {
          gaps.add("ambiguous-legacy");
          target = unconfirmed[unconfirmed.length - 1];
        } else if (sameTurn.some((c) => c.confirmed)) {
          gaps.add("ambiguous-legacy");
          continue;
        } else {
          target = {
            id: `marker:${row.sequence}`,
            turnId: row.turnId,
            sequence: row.sequence,
            startedAt: null,
            completedAt: null,
            confirmed: false,
          };
          compactions.push(target);
        }
      }
      if (!target.confirmed) {
        target.confirmed = true;
        target.completedAt = row.createdAt;
      }
      continue;
    }
    if (row.type === "provider/unhandled") {
      gaps.add("unhandled-compaction-event");
      continue;
    }
    if (row.type === "system/operation" && data.status === "completed") {
      if (data.operation === THREAD_CONTEXT_CLEAR_OPERATION) {
        clears.push({
          id: `clear:${row.sequence}`,
          at: row.createdAt,
          sequence: row.sequence,
        });
      } else if (data.operation === "edit_message") {
        gaps.add("rewound");
      } else if (data.operation === THREAD_IMPORT_OPERATION) {
        gaps.add("imported-history");
      } else if (data.operation === "teleport") {
        gaps.add("teleported");
      }
    }
  }

  pairLateItemsWithMarkers(compactions, gaps);

  const activeTurnId =
    thread.status === "active" ? getActiveStoredTurnId(db, thread.id) : null;
  const statusOf = (compaction: CompactionState) =>
    compaction.confirmed
      ? ("completed" as const)
      : activeTurnId !== null && compaction.turnId === activeTurnId
        ? ("in_progress" as const)
        : ("unconfirmed" as const);

  const chronological: Array<RecordedCompactionEntry & { sequence: number }> = [
    ...compactions.map((compaction) => ({
      kind: "compaction" as const,
      id: compaction.id,
      status: statusOf(compaction),
      startedAt: compaction.startedAt,
      completedAt: compaction.completedAt,
      turnId: compaction.turnId,
      summary: null,
      sequence: compaction.sequence,
    })),
    ...clears.map((clear) => ({ kind: "clear" as const, ...clear })),
  ].sort((left, right) => left.sequence - right.sequence);

  const newest = chronological
    .slice(-RECORDED_COMPACTIONS_LIST_LIMIT)
    .reverse()
    .map(({ sequence: _sequence, ...entry }) => entry);
  const sortedGaps = [...gaps].sort();
  const revision = createHash("sha256")
    .update(JSON.stringify([sortedGaps, chronological]))
    .digest("base64url")
    .slice(0, 16);

  return {
    revision,
    coverage: sortedGaps.length === 0 ? "complete" : "partial",
    gaps: sortedGaps,
    completedCount: compactions.filter((c) => c.confirmed).length,
    inProgress: compactions.some((c) => statusOf(c) === "in_progress"),
    entries: newest,
    truncated: chronological.length > RECORDED_COMPACTIONS_LIST_LIMIT,
  };
}

export function summarizeRecordedCompactions(
  list: RecordedCompactionsList,
): RecordedCompactionsSummary {
  return {
    revision: list.revision,
    coverage: list.coverage,
    gaps: list.gaps,
    completedCount: list.completedCount,
    inProgress: list.inProgress,
  };
}
