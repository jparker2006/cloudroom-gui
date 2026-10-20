import { useCallback, useMemo } from "react";
import type {
  TimelineCommandWorkRow,
  TimelineOutputPreview,
  TimelineRow,
  TimelineToolWorkRow,
} from "@cloudroom/server-contract";
import { useThreadTimelineTurnSummaryDetails } from "@/hooks/queries/thread-queries";

export type TimelinePreviewableWorkRow =
  | TimelineCommandWorkRow
  | TimelineToolWorkRow;

export type TimelineWorkRowFullOutputState =
  | "complete"
  | "idle-preview"
  | "streaming-preview"
  | "limited-preview"
  | "expired-preview"
  | "unavailable-preview"
  | "loading"
  | "error"
  | "loaded";

export interface TimelineWorkRowFullOutput {
  output: string;
  state: TimelineWorkRowFullOutputState;
  retry: () => void;
}

export interface TimelineWorkRowFullOutputOptions {
  enabled?: boolean;
}

function loadedOutputState(
  outputPreview: TimelineOutputPreview | undefined,
): TimelineWorkRowFullOutputState {
  if (outputPreview === undefined) {
    return "loaded";
  }
  switch (outputPreview.experimental_fullOutputAvailability) {
    case "available":
      return "error";
    case "detail-limit":
      return "limited-preview";
    case "retention-expired":
      return "expired-preview";
  }
}

function findPreviewableWorkRow(
  rows: readonly TimelineRow[],
  predicate: (row: TimelinePreviewableWorkRow) => boolean,
): TimelinePreviewableWorkRow | null {
  for (const row of rows) {
    if (
      row.kind === "work" &&
      (row.workKind === "command" || row.workKind === "tool") &&
      predicate(row)
    ) {
      return row;
    }
    const children =
      row.kind === "turn"
        ? row.children
        : row.kind === "work" && row.workKind === "delegation"
          ? row.childRows
          : null;
    if (children !== null) {
      const match = findPreviewableWorkRow(children, predicate);
      if (match !== null) {
        return match;
      }
    }
  }
  return null;
}

export function useTimelineWorkRowFullOutput(
  row: TimelinePreviewableWorkRow,
  options: TimelineWorkRowFullOutputOptions = {},
): TimelineWorkRowFullOutput {
  const outputPreview = row.outputPreview;
  const isPreview = outputPreview !== undefined;
  const shouldLoad =
    (options.enabled ?? true) &&
    isPreview &&
    outputPreview.experimental_fullOutputAvailability !== "retention-expired" &&
    row.turnId !== null &&
    row.status !== "pending";
  const { data, isError, refetch } = useThreadTimelineTurnSummaryDetails(
    {
      sourceSeqEnd: row.sourceSeqEnd,
      sourceSeqStart: row.sourceSeqStart,
      threadId: row.threadId,
      turnId: row.turnId ?? "",
    },
    { enabled: shouldLoad, refetchOnMount: false },
  );
  const retry = useCallback((): void => {
    void refetch();
  }, [refetch]);
  const loadedOutput = useMemo((): {
    output: string;
    outputPreview: TimelineOutputPreview | undefined;
  } | null => {
    if (row.status === "pending" || data === undefined) {
      return null;
    }
    const match = findPreviewableWorkRow(
      data.rows,
      (candidate) =>
        candidate.threadId === row.threadId &&
        candidate.workKind === row.workKind &&
        candidate.callId === row.callId &&
        candidate.turnId === row.turnId &&
        candidate.sourceSeqStart === row.sourceSeqStart &&
        candidate.sourceSeqEnd === row.sourceSeqEnd,
    );
    if (match === null) {
      return null;
    }
    return {
      output: match.output,
      outputPreview: match.outputPreview,
    };
  }, [
    data,
    row.callId,
    row.threadId,
    row.workKind,
    row.turnId,
    row.sourceSeqStart,
    row.sourceSeqEnd,
    row.status,
  ]);

  if (!isPreview) {
    return { output: row.output, state: "complete", retry };
  }
  if (
    outputPreview.experimental_fullOutputAvailability === "retention-expired"
  ) {
    return { output: row.output, state: "expired-preview", retry };
  }
  if (
    row.status !== "pending" &&
    row.turnId === null &&
    options.enabled !== false
  ) {
    return { output: row.output, state: "unavailable-preview", retry };
  }
  if (loadedOutput !== null) {
    return {
      output: loadedOutput.output,
      state: loadedOutputState(loadedOutput.outputPreview),
      retry,
    };
  }
  if (row.status === "pending") {
    return { output: row.output, state: "streaming-preview", retry };
  }
  if (isError || data !== undefined) {
    return { output: row.output, state: "error", retry };
  }
  if (options.enabled === false) {
    return { output: row.output, state: "idle-preview", retry };
  }
  return { output: row.output, state: "loading", retry };
}
