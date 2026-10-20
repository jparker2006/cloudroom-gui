import { useSetAtom } from "jotai";
import { UI_PREFERENCE_LIST_MAX_LENGTH } from "@cloudroom/domain";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { collapsedThreadIdsAtom } from "./sidebarCollapsedAtoms";

interface SubthreadNode {
  id: string;
  parentThreadId: string | null;
}

function ancestorIds(
  threads: readonly SubthreadNode[],
  threadId: string | null | undefined,
): Set<string> {
  const parentById = new Map(
    threads.map((thread) => [thread.id, thread.parentThreadId]),
  );
  const ancestors = new Set<string>();
  let parentId = threadId ? parentById.get(threadId) : null;
  while (parentId && !ancestors.has(parentId)) {
    ancestors.add(parentId);
    parentId = parentById.get(parentId);
  }
  return ancestors;
}

function fitPreferenceLimit(
  ids: string[],
  keep: ReadonlySet<string>,
): string[] {
  let excess = ids.length - UI_PREFERENCE_LIST_MAX_LENGTH;
  if (excess <= 0) return ids;
  return ids
    .filter((id) => {
      if (excess > 0 && !keep.has(id)) {
        excess -= 1;
        return false;
      }
      return true;
    })
    .slice(-UI_PREFERENCE_LIST_MAX_LENGTH);
}

export function collapseAllSubthreadIds(
  current: string[],
  threads: readonly SubthreadNode[],
  selectedThreadId: string | null | undefined,
): string[] {
  const keepOpen = ancestorIds(threads, selectedThreadId);
  const parentIds = new Set<string>();
  for (const thread of threads) {
    const parentId = thread.parentThreadId;
    if (parentId && !keepOpen.has(parentId)) parentIds.add(parentId);
  }
  const kept = current.filter((id) => !keepOpen.has(id));
  const seen = new Set(kept);
  const next = fitPreferenceLimit(
    [...kept, ...[...parentIds].filter((id) => !seen.has(id))],
    parentIds,
  );
  if (
    next.length === current.length &&
    next.every((id, index) => id === current[index])
  ) {
    return current;
  }
  return next;
}

export function useCollapseAllSubthreadsCommand({
  threads,
  selectedThreadId,
}: {
  threads: readonly SubthreadNode[];
  selectedThreadId: string | null | undefined;
}): void {
  const setCollapsedThreadIds = useSetAtom(collapsedThreadIdsAtom);
  useAppCommandHandler("sidebar.collapseAllSubthreads", () => {
    setCollapsedThreadIds((current) =>
      collapseAllSubthreadIds(current, threads, selectedThreadId),
    );
    return true;
  });
}
