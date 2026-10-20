import { useId } from "react";
import { Icon } from "@cloudroom/shared-ui/icon";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import { CHROME_SECTION_LABEL_CLASS } from "@cloudroom/shared-ui/chrome-style-tokens";
import {
  SubagentCountLine,
  SubagentEmptyOrError,
  SubagentScopeNote,
  SubagentTaskCard,
  type SubagentViewProps,
} from "./SubagentCards";

function getChipAccessibleName({
  summary,
  listState,
  freshness,
}: Pick<SubagentViewProps, "summary" | "listState" | "freshness">): string {
  const parts =
    listState === "loading"
      ? ["counts loading"]
      : listState === "error"
        ? ["couldn’t load, counts unknown"]
        : [
            `${summary.directCount} direct`,
            summary.nestedCount === null
              ? "nested not loaded"
              : `${summary.nestedCount} nested`,
          ];
  if (listState === "ready") {
    const attention =
      summary.buckets["needs-input"] + summary.buckets.failed + summary.buckets.host;
    if (attention) parts.push(`${attention} direct need attention`);
    if (summary.buckets.working) parts.push(`${summary.buckets.working} direct active`);
  }
  if (freshness.state === "paused") {
    parts.push(
      freshness.reason === "refresh-failed"
        ? "couldn’t refresh, showing last known"
        : "updates paused, showing last known",
    );
  }
  return `Subagents: ${parts.join(", ")}`;
}

export function SubagentHeaderChip({
  summary,
  listState,
  freshness,
  isOpen,
  onToggle,
  controlsId,
}: Pick<SubagentViewProps, "summary" | "listState" | "freshness"> & {
  isOpen: boolean;
  onToggle: () => void;
  controlsId?: string;
}) {
  const ready = listState === "ready";
  const attention = ready
    ? summary.buckets["needs-input"] + summary.buckets.failed + summary.buckets.host
    : 0;
  const working = ready ? summary.buckets.working : 0;
  return (
    <button
      type="button"
      aria-expanded={isOpen}
      aria-controls={isOpen ? controlsId : undefined}
      aria-label={getChipAccessibleName({ summary, listState, freshness })}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-border px-1.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-md:pointer-coarse:h-8 max-md:pointer-coarse:before:absolute max-md:pointer-coarse:before:-inset-1.5",
        isOpen && "bg-state-hover text-foreground",
      )}
    >
      <Icon name="Bot" className="size-3.5" aria-hidden="true" />
      <span className="tabular-nums">
        {ready ? summary.directCount : listState === "loading" ? "…" : "?"}
      </span>
      {ready && summary.nestedCount ? (
        <span className="tabular-nums text-muted-foreground">+{summary.nestedCount}</span>
      ) : null}
      {working ? (
        <span className="inline-flex items-center gap-0.5">
          <Icon name="Loading" className="size-3 animate-spin" aria-hidden="true" />
          <span className="tabular-nums">{working}</span>
        </span>
      ) : null}
      {attention ? (
        <span className="inline-flex items-center gap-0.5 text-foreground">
          <Icon name="AlertCircle" className="size-3" aria-hidden="true" />
          <span className="tabular-nums">{attention}</span>
        </span>
      ) : null}
      {freshness.state === "paused" ? (
        <Icon name="Pause" className="size-3 text-foreground" aria-hidden="true" />
      ) : null}
    </button>
  );
}

export function SubagentPanelSection({
  id,
  ...props
}: SubagentViewProps & { id?: string }) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className="grid gap-2">
      <div className="grid gap-1">
        <h2 id={headingId} className={cn(CHROME_SECTION_LABEL_CLASS)}>
          Subagents
        </h2>
        <SubagentCountLine
          summary={props.summary}
          listState={props.listState}
          className="flex-wrap text-xs"
        />
        <SubagentScopeNote {...props} />
      </div>
      <SubagentEmptyOrError {...props} />
      <ul aria-label="Subagents spawned by this thread" className="-mx-2 grid gap-0.5">
        {props.roots.map((node) => (
          <SubagentTaskCard
            key={node.entry.id}
            node={node}
            depth={0}
            now={props.now}
            useExecution={props.useExecution}
            onCardExpand={props.onCardExpand}
            defaultExpandedIds={props.defaultExpandedIds}
            density="row"
          />
        ))}
      </ul>
    </section>
  );
}
