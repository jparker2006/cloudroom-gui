import { useId } from "react";
import type {
  RecordedCompactionEntry,
  RecordedCompactionGap,
  RecordedCompactionsSummary,
} from "@cloudroom/server-contract";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import { useThreadRecordedCompactions } from "@/hooks/queries/thread-queries";

const GAP_TEXT: Record<RecordedCompactionGap, string> = {
  "ambiguous-legacy": "Some older records couldn't be told apart.",
  "cloud-auto-not-reported": "Automatic compactions in Cloud aren't reported.",
  forked: "Records copied from the source thread may be incomplete.",
  "imported-history": "Imported history has no compaction records.",
  "provider-unverified": "This agent's compaction reporting isn't verified.",
  rewound: "Edited or rewound messages removed some history.",
  teleported: "Part of this thread ran on another machine.",
  "unhandled-compaction-event": "Some compaction events couldn't be placed.",
};

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

function formatTime(value: number | null): string {
  return value === null ? "Time unknown" : TIME_FORMATTER.format(value);
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
        <span>Context cleared · {formatTime(entry.at)} · not a compaction</span>
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
          {formatTime(entry.completedAt ?? entry.startedAt)}
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
  const list = useThreadRecordedCompactions(
    threadId ?? "",
    summary?.revision ?? null,
    open && threadId !== undefined,
  );
  const listData = list.data ?? null;
  const entries =
    listData?.entries.filter(
      (entry) => entry.kind === "clear" || entry.status !== "in_progress",
    ) ?? [];
  const live = listData?.entries.find(
    (entry) => entry.kind === "compaction" && entry.status === "in_progress",
  );

  return (
    <section
      aria-labelledby={titleId}
      className="mt-3 flex flex-col gap-1.5 border-t border-border-hairline pt-2"
    >
      <div className="flex items-baseline justify-between gap-2 text-xs max-md:text-sm">
        <h3 id={titleId} className="font-medium text-muted-foreground">
          Recorded compactions
          <span className="font-normal"> · whole thread</span>
        </h3>
        <span
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
        <Note title="Partial history.">
          {summary.gaps.map((gap) => GAP_TEXT[gap]).join(" ")}
        </Note>
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
                since {CLOCK_FORMATTER.format(live.startedAt)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {summary === null || threadId === undefined ? null : list.isError ? (
        <p className="text-xs text-muted-foreground max-md:text-sm">
          Couldn't load compactions. Close and reopen to retry.
        </p>
      ) : list.isPending ? (
        <p className="text-xs text-muted-foreground max-md:text-sm">
          Loading compactions…
        </p>
      ) : listData === null ? (
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
              Showing newest 50.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
