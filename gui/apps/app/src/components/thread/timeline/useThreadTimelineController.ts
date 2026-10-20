import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useQueryClient,
  type QueryObserverResult,
} from "@tanstack/react-query";
import type { Thread, ThreadQueuedMessage } from "@cloudroom/domain";
import type {
  ThreadQueuedMessageListResponse,
  ThreadTimelineResponse,
  TimelineConversationAttachments,
  TimelineRow,
} from "@cloudroom/server-contract";
import {
  areTimelinePaginationCursorsEqual,
  buildLoadedTimelineState,
  isOptimisticTimelineRowId,
  mergeLoadedTimelineWithLatest,
  prependOlderTimelineRows,
  recoverLoadedTimelineAfterStaleCursor,
  resolveLoadedTimelineSurfaceKey,
  type LoadedTimelineState,
} from "@cloudroom/client-core";
import { useConnectionAwareQueryState } from "@/hooks/queries/connection-aware-query-state";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { isTransientReadError } from "@/hooks/queries/query-helpers";
import { buildPendingSteerTimelineRow } from "@/hooks/cache-owners/thread-runtime-cache-owner";
import {
  useThread,
  useThreadQueuedMessages,
  useThreadTimeline,
} from "@/hooks/queries/thread-queries";
import { isPendingSteerQueuedMessage } from "@/lib/queued-message-wait";
import { BbHttpError, sdk } from "@/lib/sdk";

type TimelineQueryResultProp =
  keyof QueryObserverResult<ThreadTimelineResponse>;

const TIMELINE_CONTROLLER_PROPS_WITH_ROWS: TimelineQueryResultProp[] = [
  "data",
  "error",
  "isLoading",
  "isLoadingError",
];

export const TIMELINE_CONTROLLER_PROPS_WITHOUT_ROWS: TimelineQueryResultProp[] =
  [...TIMELINE_CONTROLLER_PROPS_WITH_ROWS, "isFetching"];

interface UseThreadTimelineControllerArgs {
  enabled?: boolean;
  surfaceKey?: string;
  threadId: string;
}

export interface UseThreadTimelineControllerResult {
  activePromptMode: ThreadTimelineResponse["activePromptMode"];
  activeThinking: ThreadTimelineResponse["activeThinking"];
  activeWorkflows: ThreadTimelineResponse["activeWorkflows"];
  activeBackgroundCommands: ThreadTimelineResponse["activeBackgroundCommands"];
  contextBoundarySeq: ThreadTimelineResponse["contextBoundarySeq"];
  contextWindowUsage: ThreadTimelineResponse["contextWindowUsage"];
  goal: ThreadTimelineResponse["goal"];
  modelFallback: ThreadTimelineResponse["modelFallback"];
  hasOlderTimelineRows: boolean;
  isLoadingOlderTimelineRows: boolean;
  loadOlderTimelineRows: () => Promise<void>;
  pendingTodos: ThreadTimelineResponse["pendingTodos"];
  timelineError: Error | null;
  timelineLoading: boolean;
  timelineRows: TimelineRow[];
}

interface LoadedTimelineTracker {
  latestTimeline: ThreadTimelineResponse | undefined;
  loaded: LoadedTimelineState;
}

interface ReconcileLoadedTimelineArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineResponse | undefined;
  surfaceKey: string;
}

function isStaleTimelinePaginationCursorError(error: Error): boolean {
  return (
    error instanceof BbHttpError &&
    error.status === 400 &&
    error.code === "invalid_request"
  );
}

function buildEmptyLoadedTimelineState(
  surfaceKey: string,
): LoadedTimelineState {
  return buildLoadedTimelineState({
    latestWindowEndSequence: null,
    latestRows: [],
    olderCursor: null,
    surfaceKey,
  });
}

function reconcileLoadedTimeline({
  current,
  latestTimeline,
  surfaceKey,
}: ReconcileLoadedTimelineArgs): LoadedTimelineState {
  if (!latestTimeline) {
    return current.surfaceKey === surfaceKey
      ? current
      : buildEmptyLoadedTimelineState(surfaceKey);
  }

  return mergeLoadedTimelineWithLatest({
    current,
    latestTimeline,
    surfaceKey,
  });
}

const PENDING_STEER_HANDOFF_MS = 5_000;
const EMPTY_TIMELINE_ROWS: TimelineRow[] = [];

interface PendingSteerState {
  departed: readonly ThreadQueuedMessage[];
  queuedMessages: ThreadQueuedMessageListResponse | undefined;
  threadId: string;
  threadStatus: Thread["status"] | undefined;
  tracked: readonly ThreadQueuedMessage[];
}

function nextPendingSteerState(
  previous: PendingSteerState,
  next: Omit<PendingSteerState, "departed" | "tracked">,
): PendingSteerState {
  if (next.queuedMessages === undefined) {
    return {
      ...next,
      departed: previous.departed,
      tracked: previous.threadId === next.threadId ? previous.tracked : [],
    };
  }
  const queuedIds = new Set(next.queuedMessages.map((message) => message.id));
  const newlyDeparted =
    previous.threadId === next.threadId
      ? previous.tracked.filter((message) => !queuedIds.has(message.id))
      : [];
  return {
    ...next,
    departed: [...previous.departed, ...newlyDeparted].filter(
      (message) =>
        message.threadId !== next.threadId || !queuedIds.has(message.id),
    ),
    tracked: next.queuedMessages.filter((message) =>
      isPendingSteerQueuedMessage(message, next.threadStatus),
    ),
  };
}

function steerMatchKey(
  text: string,
  attachments: TimelineConversationAttachments | null,
): string {
  return JSON.stringify([
    text.replace(/\s+/g, ""),
    attachments?.webImages ?? 0,
    attachments?.localImages ?? 0,
    attachments?.localFiles ?? 0,
    attachments?.imageUrls ?? [],
    attachments?.localImagePaths ?? [],
    attachments?.localFilePaths ?? [],
  ]);
}

export function appendPendingSteerRows(
  rows: TimelineRow[],
  pendingSteers: readonly ThreadQueuedMessage[],
): TimelineRow[] {
  if (pendingSteers.length === 0) return rows;
  const claimedRowIds = new Set<string>();
  const appendedRows: TimelineRow[] = [];
  for (const pendingSteer of pendingSteers) {
    const pendingRow = buildPendingSteerTimelineRow(pendingSteer);
    const pendingKey = steerMatchKey(pendingRow.text, pendingRow.attachments);
    const matchingRow = rows.find(
      (row) =>
        !claimedRowIds.has(row.id) &&
        row.kind === "conversation" &&
        row.role === "user" &&
        steerMatchKey(row.text, row.attachments) === pendingKey &&
        (isOptimisticTimelineRowId(row.id) ||
          row.createdAt >= pendingSteer.createdAt),
    );
    if (matchingRow) {
      claimedRowIds.add(matchingRow.id);
    } else {
      appendedRows.push(pendingRow);
    }
  }
  return appendedRows.length === 0 ? rows : [...rows, ...appendedRows];
}

export function usePendingSteerHandoff(
  threadId: string,
  threadStatus: Thread["status"] | undefined,
  queuedMessages: ThreadQueuedMessageListResponse | undefined,
): readonly ThreadQueuedMessage[] {
  const [state, setState] = useState<PendingSteerState>(() =>
    nextPendingSteerState(
      { departed: [], queuedMessages, threadId, threadStatus, tracked: [] },
      { queuedMessages, threadId, threadStatus },
    ),
  );
  let current = state;
  if (
    state.threadId !== threadId ||
    state.threadStatus !== threadStatus ||
    state.queuedMessages !== queuedMessages
  ) {
    current = nextPendingSteerState(state, {
      queuedMessages,
      threadId,
      threadStatus,
    });
    setState(current);
  }
  const departedIds = current.departed.map((message) => message.id).join(",");
  const departureTimers = useRef(new Map<string, number>());
  useEffect(() => {
    const timers = departureTimers.current;
    const ids = new Set(departedIds === "" ? [] : departedIds.split(","));
    for (const [id, timer] of timers) {
      if (ids.has(id)) continue;
      clearTimeout(timer);
      timers.delete(id);
    }
    for (const id of ids) {
      if (timers.has(id)) continue;
      timers.set(
        id,
        window.setTimeout(() => {
          timers.delete(id);
          setState((latest) => ({
            ...latest,
            departed: latest.departed.filter((message) => message.id !== id),
          }));
        }, PENDING_STEER_HANDOFF_MS),
      );
    }
  }, [departedIds]);
  useEffect(() => {
    const timers = departureTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);
  return useMemo(
    () =>
      [
        ...current.tracked,
        ...current.departed.filter((message) => message.threadId === threadId),
      ].sort((left, right) => left.createdAt - right.createdAt),
    [current.departed, current.tracked, threadId],
  );
}

export function useThreadTimelineController({
  enabled = true,
  surfaceKey: explicitSurfaceKey,
  threadId,
}: UseThreadTimelineControllerArgs): UseThreadTimelineControllerResult {
  const queryClient = useQueryClient();
  const notifyOnChangeProps = useCallback((): TimelineQueryResultProp[] => {
    const cachedTimeline = queryClient.getQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey(threadId),
    );
    return cachedTimeline !== undefined && cachedTimeline.rows.length > 0
      ? TIMELINE_CONTROLLER_PROPS_WITH_ROWS
      : TIMELINE_CONTROLLER_PROPS_WITHOUT_ROWS;
  }, [queryClient, threadId]);
  const latestTimelineQuery = useThreadTimeline(threadId, {
    enabled,
    notifyOnChangeProps,
    refetchOnMount: true,
  });
  const latestTimeline = latestTimelineQuery.data;
  const surfaceKey = resolveLoadedTimelineSurfaceKey(
    explicitSurfaceKey ?? threadId,
    latestTimeline,
  );
  const [loadedTimelineTracker, setLoadedTimelineTracker] =
    useState<LoadedTimelineTracker>(() => ({
      latestTimeline,
      loaded: reconcileLoadedTimeline({
        current: buildEmptyLoadedTimelineState(surfaceKey),
        latestTimeline,
        surfaceKey,
      }),
    }));
  let loadedTimeline = loadedTimelineTracker.loaded;
  if (
    loadedTimelineTracker.latestTimeline !== latestTimeline ||
    loadedTimeline.surfaceKey !== surfaceKey
  ) {
    loadedTimeline = reconcileLoadedTimeline({
      current: loadedTimelineTracker.loaded,
      latestTimeline,
      surfaceKey,
    });
    setLoadedTimelineTracker({ latestTimeline, loaded: loadedTimeline });
  }
  const updateLoadedTimeline = useCallback(
    (update: (current: LoadedTimelineState) => LoadedTimelineState) => {
      setLoadedTimelineTracker((current) => {
        const loaded = update(current.loaded);
        return loaded === current.loaded ? current : { ...current, loaded };
      });
    },
    [],
  );
  const [isLoadingOlderTimelineRows, setIsLoadingOlderTimelineRows] =
    useState(false);
  const refetchLatestTimeline = latestTimelineQuery.refetch;

  const nextOlderCursor =
    loadedTimeline.surfaceKey === surfaceKey
      ? loadedTimeline.olderCursor
      : null;
  const hasOlderTimelineRows = nextOlderCursor !== null;
  const loadOlderTimelineRows = useCallback(async (): Promise<void> => {
    if (
      !enabled ||
      !nextOlderCursor ||
      !threadId ||
      isLoadingOlderTimelineRows
    ) {
      return;
    }

    setIsLoadingOlderTimelineRows(true);
    try {
      const response = await sdk.threads.timeline({
        beforeAnchorId: nextOlderCursor.anchorId,
        beforeAnchorSeq: String(nextOlderCursor.anchorSeq),
        threadId,
      });
      const olderRows = [...response.rows];
      updateLoadedTimeline((current) => {
        if (
          current.surfaceKey !== surfaceKey ||
          !areTimelinePaginationCursorsEqual({
            left: current.olderCursor,
            right: nextOlderCursor,
          })
        ) {
          return current;
        }
        return {
          ...current,
          olderCursor: response.timelinePage.olderCursor,
          rows: prependOlderTimelineRows({
            loadedRows: current.rows,
            olderRows,
          }),
        };
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !isStaleTimelinePaginationCursorError(error)
      ) {
        throw error;
      }

      const latestTimelineResult = await refetchLatestTimeline();
      const recoveredLatestTimeline =
        latestTimelineResult.data ?? latestTimeline;
      updateLoadedTimeline((current) => {
        if (current.surfaceKey !== surfaceKey) {
          return current;
        }
        if (!recoveredLatestTimeline) {
          return {
            ...current,
            olderCursor: null,
          };
        }
        return recoverLoadedTimelineAfterStaleCursor({
          current,
          latestTimeline: recoveredLatestTimeline,
          surfaceKey,
        });
      });
    } finally {
      setIsLoadingOlderTimelineRows(false);
    }
  }, [
    enabled,
    isLoadingOlderTimelineRows,
    latestTimeline,
    nextOlderCursor,
    refetchLatestTimeline,
    surfaceKey,
    threadId,
    updateLoadedTimeline,
  ]);
  const loadedTimelineRows =
    loadedTimeline.surfaceKey === surfaceKey && loadedTimeline.rows.length > 0
      ? loadedTimeline.rows
      : (latestTimeline?.rows ?? EMPTY_TIMELINE_ROWS);
  const { data: queuedMessages } = useThreadQueuedMessages(threadId, {
    enabled,
  });
  const { data: thread } = useThread(threadId, { enabled });
  const pendingSteers = usePendingSteerHandoff(
    threadId,
    thread?.status,
    queuedMessages,
  );
  const timelineRows = useMemo(
    () =>
      latestTimeline === undefined
        ? loadedTimelineRows
        : appendPendingSteerRows(loadedTimelineRows, pendingSteers),
    [latestTimeline, loadedTimelineRows, pendingSteers],
  );
  const timelineQueryState = useConnectionAwareQueryState({
    hasResolvedData:
      latestTimelineQuery.data !== undefined || loadedTimelineRows.length > 0,
    isFetching: latestTimelineQuery.isFetching,
    isLoadingError: latestTimelineQuery.isLoadingError,
    isRecoverableLoadingError: isTransientReadError(latestTimelineQuery.error),
  });
  const timelineLoading =
    latestTimelineQuery.isLoading ||
    (timelineQueryState.status === "loading" && loadedTimelineRows.length === 0) ||
    (latestTimelineQuery.isFetching && loadedTimelineRows.length === 0);
  const timelineError =
    timelineLoading || timelineQueryState.status !== "unavailable"
      ? null
      : latestTimelineQuery.error;

  return {
    activePromptMode: latestTimeline?.activePromptMode ?? null,
    activeThinking: latestTimeline?.activeThinking ?? null,
    activeWorkflows: latestTimeline?.activeWorkflows ?? [],
    activeBackgroundCommands: latestTimeline?.activeBackgroundCommands ?? [],
    contextBoundarySeq: latestTimeline?.contextBoundarySeq ?? null,
    contextWindowUsage: latestTimeline?.contextWindowUsage,
    goal: latestTimeline?.goal ?? null,
    modelFallback: latestTimeline?.modelFallback ?? null,
    hasOlderTimelineRows,
    isLoadingOlderTimelineRows,
    loadOlderTimelineRows,
    pendingTodos: latestTimeline?.pendingTodos ?? null,
    timelineError,
    timelineLoading,
    timelineRows,
  };
}
