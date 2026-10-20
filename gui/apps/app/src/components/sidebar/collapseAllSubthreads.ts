import { useSetAtom } from "jotai";
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

export function collapseAllSubthreadIds(
  current: string[],
  threads: readonly SubthreadNode[],
  selectedThreadId: string | null | undefined,
): string[] {
  const keepOpen = ancestorIds(threads, selectedThreadId);
  const next = current.filter((id) => !keepOpen.has(id));
  const seen = new Set(next);
  for (const thread of threads) {
    const parentId = thread.parentThreadId;
    if (parentId && !seen.has(parentId) && !keepOpen.has(parentId)) {
      seen.add(parentId);
      next.push(parentId);
    }
  }
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
