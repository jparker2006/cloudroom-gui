import { useId, useState } from "react";
import {
  RECORDED_COMPACTION_GAP_TEXT,
  type RecordedCompactionEntry,
  type RecordedCompactionsSummary,
} from "@cloudroom/server-contract";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import { useThreadRecordedCompactions } from "@/hooks/queries/thread-queries";

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const CLOCK_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function Time({ value }: { value: number | null }) {
  return value === null ? (
    <>Time unknown</>
  ) : (
    <time dateTime={new Date(value).toISOString()}>
      {TIME_FORMATTER.format(value)}
    </time>
  );
}

export function recordedCompactionsCountLabel(
  summary: RecordedCompactionsSummary | null,
): string {
  if (summary === null) return "Not available";
  const partial = summary.coverage === "partial";
  if (summary.completedCount === 0) {
    return partial ? "None in recorded history" : "None recorded";
  }
  return `${summary.completedCount} recorded${partial ? " · partial" : ""}`;
}

function Note({ title, children }: { title: string; children: string }) {
  return (
    <p
      role="note"
      className="flex gap-1.5 text-xs text-muted-foreground max-md:text-sm"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        aria-hidden="true"
        data-icon-root=""
        className="mt-0.5 size-3 shrink-0"
      >
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 7v4M8 5v.01" />
      </svg>
      <span>
        <span className="font-medium text-foreground">{title} </span>
        {children}
      </span>
    </p>
  );
}

function EntryRow({ entry }: { entry: RecordedCompactionEntry }) {
  if (entry.kind === "clear") {
    return (
      <li className="flex items-center gap-2 py-1.5 text-xs text-muted-foreground max-md:text-sm">
        <span
          aria-hidden="true"
          className="h-px flex-1 border-t border-dashed border-border"
        />
        <span>
          Context cleared · <Time value={entry.at} /> · not a compaction
        </span>
        <span
          aria-hidden="true"
          className="h-px flex-1 border-t border-dashed border-border"
        />
      </li>
    );
  }
  const counted = entry.status === "completed";
  return (
    <li className="py-1.5 text-xs max-md:text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className={counted ? "text-foreground" : "text-muted-foreground"}>
          {counted ? "Context compacted" : "Not confirmed · not counted"}
        </span>
        <span className="tabular-nums text-muted-foreground">
          <Time value={entry.completedAt ?? entry.startedAt} />
        </span>
      </div>
      {counted ? (
        <p
          className={cn(
            "mt-0.5 text-muted-foreground [overflow-wrap:anywhere]",
            entry.summary === null && "italic",
          )}
        >
          {entry.summary ?? "Summary not provided."}
        </p>
      ) : null}
    </li>
  );
}

function useCompletionAnnouncement(
  summary: RecordedCompactionsSummary | null,
): string {
  const [previous, setPrevious] = useState(summary);
  const [announcement, setAnnouncement] = useState("");
  if (previous !== summary) {
    setPrevious(summary);
    if (summary?.inProgress) {
      setAnnouncement("");
    } else if (previous !== null && summary !== null && previous.inProgress) {
      setAnnouncement(
        summary.completedCount > previous.completedCount
          ? "Compaction recorded."
          : "Compaction ended without a recorded result.",
      );
    }
  }
  return announcement;
}

export function RecordedCompactionsSection({
  summary,
  threadId,
  open,
}: {
  summary: RecordedCompactionsSummary | null;
  threadId: string | undefined;
  open: boolean;
}) {
  const titleId = useId();
  const countId = useId();
  const announcement = useCompletionAnnouncement(summary);
  const listEnabled = open && threadId !== undefined;
  const list = useThreadRecordedCompactions(
    threadId ?? "",
    summary?.revision ?? null,
    listEnabled,
  );
  const listData = list.data ?? null;
  const stale =
    listData !== null &&
    summary !== null &&
    listData.revision !== summary.revision;
  const entries =
    listData?.entries.filter(
      (entry) => entry.kind === "clear" || entry.status !== "in_progress",
    ) ?? [];
  const live = stale
    ? undefined
    : listData?.entries.find(
        (entry) =>
          entry.kind === "compaction" && entry.status === "in_progress",
      );
  const gapText =
    summary === null || summary.gaps.length === 0
      ? "Some history may be missing."
      : summary.gaps.map((gap) => RECORDED_COMPACTION_GAP_TEXT[gap]).join(" ");

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={countId}
      className="mt-3 flex flex-col gap-1.5 border-t border-border-hairline pt-2"
    >
      <div className="flex items-baseline justify-between gap-2 text-xs max-md:text-sm">
        <h3 id={titleId} className="font-medium text-muted-foreground">
          Recorded compactions
          {summary?.coverage === "complete" ? (
            <span className="font-normal"> · whole thread</span>
          ) : null}
        </h3>
        <span
          id={countId}
          className={cn(
            "shrink-0 tabular-nums",
            summary === null
              ? "text-muted-foreground"
              : "font-medium text-foreground",
          )}
        >
          {recordedCompactionsCountLabel(summary)}
        </span>
      </div>
      {summary === null ? (
        <Note title="Not available.">
          Update Cloudroom to see compactions for this thread.
        </Note>
      ) : summary.coverage === "partial" ? (
        <Note title="Partial history.">{gapText}</Note>
      ) : null}
      <div role="status" aria-live="polite">
        {summary?.inProgress ? (
          <div className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs max-md:text-sm">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 animate-pulse rounded-full bg-current text-foreground motion-reduce:animate-none"
            />
            <span className="flex-1 text-foreground">
              Compacting now · not counted yet
            </span>
            {live?.kind === "compaction" && live.startedAt !== null ? (
              <span className="tabular-nums text-muted-foreground">
                since{" "}
                <time dateTime={new Date(live.startedAt).toISOString()}>
                  {CLOCK_FORMATTER.format(live.startedAt)}
                </time>
              </span>
            ) : null}
          </div>
        ) : (
          <span className="sr-only">{announcement}</span>
        )}
        {summary === null || !listEnabled ? null : list.isError ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground max-md:text-sm">
            Couldn't load compactions.
            <button
              type="button"
              className="cursor-pointer rounded-xs underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
              onClick={() => void list.refetch()}
            >
              Retry
            </button>
          </p>
        ) : null}
      </div>
      {summary !== null &&
      listEnabled &&
      !list.isError &&
      (list.isPending || stale) ? (
        <p className="text-xs text-muted-foreground max-md:text-sm">
          {stale ? "Updating compactions…" : "Loading compactions…"}
        </p>
      ) : null}
      {summary === null ||
      !listEnabled ||
      list.isError ||
      list.isPending ||
      stale ? null : listData === null ? (
        <Note title="Not available.">
          Update Cloudroom to see compactions for this thread.
        </Note>
      ) : entries.length === 0 ? null : (
        <>
          <ol
            tabIndex={0}
            aria-label="Recorded compactions, newest first"
            className="max-h-56 overflow-y-auto overscroll-contain rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </ol>
          {listData.truncated ? (
            <p className="text-xs text-muted-foreground max-md:text-sm">
              Showing the newest 50 entries. The count includes older recorded
              compactions.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
