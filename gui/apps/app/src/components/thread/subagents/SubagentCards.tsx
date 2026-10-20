import { useId, useState, type ReactNode } from "react";
import { Icon } from "@cloudroom/shared-ui/icon";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import { RouteAnchor } from "@/components/ui/app-route-anchor";
import { getThreadRoutePath } from "@/lib/route-paths";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  SUBAGENT_BUCKET_LABELS,
  getSubagentBucket,
  getSubagentFlags,
  getSubagentStatus,
  getSubagentTask,
  type SubagentBucket,
  type SubagentEntry,
  type SubagentExecution,
  type SubagentFreshness,
  type SubagentNode,
  type SubagentSummary,
} from "./subagent-model";

export interface SubagentViewProps {
  roots: readonly SubagentNode[];
  summary: SubagentSummary;
  freshness: SubagentFreshness;
  listState: "ready" | "loading" | "error";
  now: number;
  useExecution: (entry: SubagentEntry) => SubagentExecution;
  onCardExpand?: (entry: SubagentEntry) => void;
  defaultExpandedIds?: ReadonlySet<string>;
}

const BUCKET_ORDER: readonly SubagentBucket[] = [
  "needs-input",
  "failed",
  "host",
  "working",
  "not-started",
  "idle",
];

const BUCKET_TONE_CLASS: Record<SubagentBucket, string> = {
  "needs-input": "text-foreground",
  failed: "text-destructive-text",
  host: "text-foreground",
  working: "text-foreground",
  "not-started": "text-muted-foreground",
  idle: "text-muted-foreground",
};

export function SubagentBucketGlyph({
  bucket,
  className,
}: {
  bucket: SubagentBucket;
  className?: string;
}) {
  const base = cn("size-3.5 shrink-0", className);
  switch (bucket) {
    case "working":
      return (
        <Icon
          name="Loading"
          className={cn(base, "animate-spin text-muted-foreground")}
          aria-hidden="true"
        />
      );
    case "needs-input":
      return <Icon name="CircleQuestion" className={cn(base, "text-foreground")} aria-hidden="true" />;
    case "failed":
      return <Icon name="CircleX" className={cn(base, "text-destructive-text")} aria-hidden="true" />;
    case "host":
      return <Icon name="Unavailable" className={cn(base, "text-foreground")} aria-hidden="true" />;
    case "not-started":
      return <Icon name="Clock" className={cn(base, "text-muted-foreground")} aria-hidden="true" />;
    case "idle":
      return <Icon name="Circle" className={cn(base, "text-muted-foreground/70")} aria-hidden="true" />;
  }
}

export function SubagentScopeNote({
  summary,
  freshness,
  listState,
  now,
}: Pick<SubagentViewProps, "summary" | "freshness" | "listState" | "now">) {
  const parts: ReactNode[] = [];
  if (listState === "ready") {
    parts.push(<span key="scope">Open, non-archived threads you can see</span>);
    parts.push(
      <span key="nested">
        {summary.nestedCount === null
          ? "Nested threads not loaded"
          : "Archived nested threads not counted"}
      </span>,
    );
  }
  if (freshness.state === "paused") {
    parts.push(
      <span key="fresh" className="text-foreground">
        {freshness.reason === "refresh-failed" ? "Couldn’t refresh" : "Updates paused"}
        {freshness.since !== null
          ? ` · last known ${formatRelativeTime({ timestamp: freshness.since, now })}`
          : " · showing last known"}
      </span>,
    );
  }
  return <p className="grid gap-0.5 text-xs text-muted-foreground">{parts}</p>;
}

export function SubagentCountLine({
  summary,
  listState,
  className,
}: Pick<SubagentViewProps, "summary" | "listState"> & { className?: string }) {
  if (listState !== "ready") {
    return (
      <span className={cn("text-left text-muted-foreground", className)}>
        {listState === "loading" ? "Subagents · loading" : "Subagents · couldn’t load, counts unknown"}
      </span>
    );
  }
  const direct = summary.directCount;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-left", className)}>
      <span className="shrink-0 font-medium text-foreground">
        {direct === 0 ? "No open subagents" : direct === 1 ? "1 subagent" : `${direct} subagents`}
        <span className="font-normal text-muted-foreground">
          {summary.nestedCount === null
            ? " · nested not loaded"
            : summary.nestedCount > 0
              ? ` + ${summary.nestedCount} nested`
              : null}
        </span>
        {direct > 0 ? <span className="sr-only">. Direct subagents:</span> : null}
      </span>
      {BUCKET_ORDER.filter((bucket) => summary.buckets[bucket] > 0).map((bucket) => (
        <span
          key={bucket}
          className={cn("inline-flex shrink-0 items-center gap-1", BUCKET_TONE_CLASS[bucket])}
        >
          <SubagentBucketGlyph bucket={bucket} className="size-3" />
          {summary.buckets[bucket]} {SUBAGENT_BUCKET_LABELS[bucket]}
        </span>
      ))}
    </span>
  );
}

function ExecutionText({ execution }: { execution: SubagentExecution }) {
  switch (execution.state) {
    case "loading":
      return <span className="text-muted-foreground">Loading…</span>;
    case "unavailable":
      return <span className="text-muted-foreground">Unavailable · {execution.reason}</span>;
    case "not-recorded":
      return <span className="text-muted-foreground">Not recorded</span>;
    case "recorded":
      return (
        <span className="grid">
          <span className="[overflow-wrap:anywhere]">{execution.model}</span>
          <span className="text-muted-foreground">
            {execution.effort === null
              ? "Effort not recorded"
              : `Effort setting: ${execution.effort}`}
          </span>
        </span>
      );
  }
}

function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

function FlagChips({ entry }: { entry: SubagentEntry }) {
  const flags = getSubagentFlags(entry);
  if (flags.length === 0) return null;
  return (
    <>
      {flags.map((flag) => (
        <span
          key={flag.kind}
          className={cn(
            "inline-flex shrink-0 items-center rounded-sm px-1.5 text-[11px] leading-5",
            flag.kind === "queued-failed"
              ? "bg-destructive/10 text-destructive-text"
              : flag.kind === "needs-input"
                ? "bg-foreground/10 text-foreground"
                : "bg-muted text-muted-foreground",
          )}
        >
          {flag.label}
        </span>
      ))}
    </>
  );
}

function ExecutionFact({
  entry,
  useExecution,
}: {
  entry: SubagentEntry;
  useExecution: SubagentViewProps["useExecution"];
}) {
  const execution = useExecution(entry);
  return <ExecutionText execution={execution} />;
}

function CardDetails({
  entry,
  now,
  useExecution,
  nestedNotLoaded,
}: {
  entry: SubagentEntry;
  now: number;
  useExecution: SubagentViewProps["useExecution"];
  nestedNotLoaded: boolean;
}) {
  const status = getSubagentStatus(entry);
  const { task } = getSubagentTask(entry);
  return (
    <dl className="grid gap-1.5">
      <FactRow label="Prompt preview">
        {task ? (
          <span className="whitespace-pre-wrap break-words">{task}</span>
        ) : (
          <span className="text-muted-foreground">Not recorded</span>
        )}
      </FactRow>
      <FactRow label="Status">
        {status.label}
        <span className="text-muted-foreground"> · {status.detail}</span>
      </FactRow>
      <FactRow label="Model">
        <ExecutionFact entry={entry} useExecution={useExecution} />
      </FactRow>
      <FactRow label="Runs on">
        {entry.providerId}
        <span className="text-muted-foreground">
          {" · "}
          {entry.executionTarget === "cloud"
            ? "Cloud"
            : entry.executionTarget === "local"
              ? "Local"
              : "Location not recorded"}
        </span>
      </FactRow>
      <FactRow label="Last change">
        {formatRelativeTime({ timestamp: entry.updatedAt, now })}
      </FactRow>
      {nestedNotLoaded ? (
        <FactRow label="Nested">
          <span className="text-muted-foreground">Not loaded</span>
        </FactRow>
      ) : null}
    </dl>
  );
}

function OpenThreadLink({ entry, className }: { entry: SubagentEntry; className?: string }) {
  const { title } = getSubagentTask(entry);
  return (
    <RouteAnchor
      href={getThreadRoutePath({ projectId: entry.projectId, threadId: entry.id })}
      className={cn(
        "inline-flex min-h-8 items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:min-h-11",
        className,
      )}
      aria-label={`Open thread: ${title}`}
    >
      Open thread
      <Icon name="ArrowUpRight" className="size-3" aria-hidden="true" />
    </RouteAnchor>
  );
}

interface TaskCardProps {
  node: SubagentNode;
  depth: number;
  now: number;
  useExecution: SubagentViewProps["useExecution"];
  onCardExpand?: SubagentViewProps["onCardExpand"];
  defaultExpandedIds?: ReadonlySet<string>;
  density: "card" | "row";
}

export function SubagentTaskCard({
  node,
  depth,
  now,
  useExecution,
  onCardExpand,
  defaultExpandedIds,
  density,
}: TaskCardProps) {
  const [expanded, setExpanded] = useState(
    defaultExpandedIds?.has(node.entry.id) ?? false,
  );
  const bodyId = useId();
  const { entry } = node;
  const status = getSubagentStatus(entry);
  const bucket = getSubagentBucket(entry);
  const { title, task } = getSubagentTask(entry);
  const toggle = () => {
    if (!expanded) onCardExpand?.(entry);
    setExpanded(!expanded);
  };
  const isCard = density === "card";
  return (
    <li
      className={cn(
        "min-w-0 list-none",
        isCard && depth === 0 && "rounded-md border border-border/60 bg-background",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={toggle}
        className={cn(
          "group/card flex w-full min-w-0 items-start gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          isCard ? "px-3 py-2" : "px-2 py-1.5 hover:bg-muted/50",
          "max-md:min-h-11",
        )}
      >
        <span className="mt-0.5 flex size-4 items-center justify-center">
          <SubagentBucketGlyph bucket={bucket} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={cn("min-w-0 text-sm text-foreground", expanded ? "break-words" : "truncate")}>
              {title}
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              <span className="sr-only">Status: </span>
              {status.label}
            </span>
          </span>
          {isCard && task && !expanded ? (
            <span className="line-clamp-1 text-xs text-muted-foreground">{task}</span>
          ) : null}
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 empty:hidden">
            <FlagChips entry={entry} />
            {node.descendantCount ? (
              <span className="text-[11px] leading-5 text-muted-foreground">
                {node.descendantCount === 1 ? "1 nested" : `${node.descendantCount} nested`}
              </span>
            ) : null}
          </span>
        </span>
        <Icon
          name="ChevronRight"
          className={cn(
            "mt-1 size-3 shrink-0 text-muted-foreground transition-transform duration-150",
            expanded && "rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <div
          id={bodyId}
          className={cn("grid gap-2 pb-2", isCard ? "px-3 pl-9" : "pr-2 pl-8")}
        >
          <CardDetails
            entry={entry}
            now={now}
            useExecution={useExecution}
            nestedNotLoaded={node.descendantCount === null}
          />
          <OpenThreadLink entry={entry} className="justify-self-start" />
          {node.children.length > 0 ? (
            <div className="grid gap-1">
              <p className="text-xs text-muted-foreground">
                Spawned by this thread · {node.children.length} direct
                {node.descendantCount !== null && node.descendantCount > node.children.length
                  ? ` · ${node.descendantCount - node.children.length} nested deeper`
                  : ""}
              </p>
              <ul
                aria-label={`Threads spawned by ${title}`}
                className="grid gap-0.5 border-l border-border/70 pl-2"
              >
                {node.children.map((child) => (
                  <SubagentTaskCard
                    key={child.entry.id}
                    node={child}
                    depth={depth + 1}
                    now={now}
                    useExecution={useExecution}
                    onCardExpand={onCardExpand}
                    defaultExpandedIds={defaultExpandedIds}
                    density="row"
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function SubagentEmptyOrError({
  listState,
  summary,
}: Pick<SubagentViewProps, "listState" | "summary">) {
  if (listState === "error") {
    return (
      <p className="px-3 py-2 text-xs text-destructive-text" role="status">
        Couldn’t load subagents. This is not the same as having none.
      </p>
    );
  }
  if (listState === "loading") {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground" role="status">
        Loading subagents…
      </p>
    );
  }
  if (summary.directCount === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">No open subagents listed.</p>
    );
  }
  return null;
}
