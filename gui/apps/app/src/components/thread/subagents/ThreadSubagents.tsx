import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ThreadListEntry } from "@cloudroom/domain";
import { useChildThreads } from "@/hooks/queries/thread-queries";
import { useSidebarNavigationThreadSelection } from "@/hooks/queries/sidebar-navigation-query";
import { fetchCloudroomThreadStatus } from "@/hooks/queries/cloudroom-queries";
import { useServerConnectionState } from "@/hooks/useServerConnectionState";
import {
  buildSubagentTree,
  summarizeSubagents,
  type SubagentEntry,
  type SubagentExecution,
} from "./subagent-model";
import type { SubagentViewProps } from "./SubagentCards";
import { SubagentHeaderChip, SubagentPanelSection } from "./SubagentPanel";

const EXECUTION_STALE_TIME_MS = 30_000;

export function getThreadSubagentsSectionId(threadId: string): string {
  return `thread-subagents-${threadId}`;
}

function selectVisibleChildThreads(threads: ThreadListEntry[]): ThreadListEntry[] {
  return threads.filter(
    (thread) => thread.parentThreadId !== null && thread.visibility !== "hidden",
  );
}

function useSubagentExecution(entry: SubagentEntry): SubagentExecution {
  const isCloud = entry.executionTarget === "cloud";
  const query = useQuery({
    queryKey: ["cloudroom-thread", entry.id],
    queryFn: ({ signal }) => fetchCloudroomThreadStatus(entry.id, signal),
    enabled: isCloud,
    staleTime: EXECUTION_STALE_TIME_MS,
  });
  if (!isCloud) return { state: "not-recorded" };
  if (query.isError) return { state: "unavailable", reason: "couldn’t load" };
  if (query.data === undefined) return { state: "loading" };
  if (query.data === null) return { state: "not-recorded" };
  return { state: "recorded", model: query.data.model, effort: query.data.reasoning };
}

function useThreadSubagents(threadId: string): Omit<SubagentViewProps, "onCardExpand"> {
  const sidebar = useSidebarNavigationThreadSelection(selectVisibleChildThreads);
  const direct = useChildThreads({ enabled: true, parentThreadId: threadId });
  const connection = useServerConnectionState();
  const coverage = sidebar.data === undefined ? "direct-only" : "all-visible";
  const entries = sidebar.data ?? direct.data;
  const roots = useMemo(
    () => buildSubagentTree(threadId, entries ?? [], coverage),
    [coverage, entries, threadId],
  );
  return {
    roots,
    summary: useMemo(() => summarizeSubagents(roots, coverage), [coverage, roots]),
    listState:
      entries !== undefined ? "ready" : direct.isError ? "error" : "loading",
    freshness:
      connection !== "connected"
        ? { state: "paused", since: null }
        : coverage === "direct-only" && entries !== undefined && direct.isError
          ? { state: "paused", since: null, reason: "refresh-failed" }
          : { state: "live" },
    now: Date.now(),
    useExecution: useSubagentExecution,
  };
}

export function ThreadSubagentChip({
  threadId,
  isOpen,
  onToggle,
}: {
  threadId: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const view = useThreadSubagents(threadId);
  if (view.listState !== "error" && view.summary.directCount === 0) return null;
  return (
    <SubagentHeaderChip
      summary={view.summary}
      listState={view.listState}
      freshness={view.freshness}
      isOpen={isOpen}
      onToggle={onToggle}
      controlsId={getThreadSubagentsSectionId(threadId)}
    />
  );
}

export function useHasThreadSubagents(threadId: string): boolean {
  const view = useThreadSubagents(threadId);
  return view.listState === "error" || view.summary.directCount > 0;
}

export function ThreadSubagentsRow({ threadId }: { threadId: string }) {
  const view = useThreadSubagents(threadId);
  if (view.listState !== "error" && view.summary.directCount === 0) return null;
  return (
    <>
      <div className="mb-1 mt-3 border-t border-border" aria-hidden />
      <SubagentPanelSection id={getThreadSubagentsSectionId(threadId)} {...view} />
    </>
  );
}
