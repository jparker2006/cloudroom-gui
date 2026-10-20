import { useId, useState } from "react";
import { Icon } from "@cloudroom/shared-ui/icon";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import {
  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
  PromptStackCard,
  PromptStackCardChevron,
} from "@/components/promptbox/banner/PromptStackCard";
import {
  SubagentCountLine,
  SubagentEmptyOrError,
  SubagentScopeNote,
  SubagentTaskCard,
  type SubagentViewProps,
} from "./SubagentCards";

function TaskList({
  density,
  ...props
}: SubagentViewProps & { density: "card" | "row" }) {
  return (
    <ul
      aria-label="Subagents spawned by this thread"
      className={cn("grid", density === "card" ? "gap-1.5" : "gap-0.5")}
    >
      {props.roots.map((node) => (
        <SubagentTaskCard
          key={node.entry.id}
          node={node}
          depth={0}
          now={props.now}
          getExecution={props.getExecution}
          onCardExpand={props.onCardExpand}
          defaultExpandedIds={props.defaultExpandedIds}
          density={density}
        />
      ))}
    </ul>
  );
}

export function SubagentComposerCard({
  defaultExpanded = false,
  ...props
}: SubagentViewProps & { defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggleId = useId();
  const bodyId = useId();
  return (
    <PromptStackCard ariaLabel="Subagents" className="overflow-hidden">
      <button
        type="button"
        id={toggleId}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded(!expanded)}
        className={cn(PROMPT_STACK_CARD_HEADER_BUTTON_CLASS, "max-md:min-h-11")}
      >
        <Icon name="Bot" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <SubagentCountLine
          summary={props.summary}
          listState={props.listState}
          className="flex-1 text-xs"
        />
        {props.freshness.state === "paused" ? (
          <span className="shrink-0 text-2xs text-foreground">Updates paused</span>
        ) : null}
        <PromptStackCardChevron isExpanded={expanded} className="text-muted-foreground" />
      </button>
      {expanded ? (
        <section
          id={bodyId}
          aria-labelledby={toggleId}
          className="grid max-h-[min(50vh,28rem)] gap-2 overflow-y-auto overscroll-contain border-t border-border bg-popover p-2"
        >
          <SubagentScopeNote {...props} />
          <SubagentEmptyOrError {...props} />
          <TaskList {...props} density="card" />
        </section>
      ) : null}
    </PromptStackCard>
  );
}

export function SubagentHeaderChip({
  summary,
  listState,
  freshness,
  isOpen,
  onToggle,
}: Pick<SubagentViewProps, "summary" | "listState" | "freshness"> & {
  isOpen: boolean;
  onToggle: () => void;
}) {
  const attention = summary.buckets["needs-input"] + summary.buckets.failed + summary.buckets.host;
  const working = summary.buckets.working;
  const label =
    listState === "ready"
      ? `${summary.directCount + summary.nestedCount}`
      : listState === "loading"
        ? "…"
        : "?";
  return (
    <button
      type="button"
      aria-pressed={isOpen}
      aria-label={`Subagents: ${summary.directCount} direct, ${summary.nestedCount} nested${
        attention ? `, ${attention} need attention` : ""
      }${working ? `, ${working} working` : ""}${listState !== "ready" ? `, list ${listState}` : ""}`}
      onClick={onToggle}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-md:h-11",
        isOpen && "bg-state-hover text-foreground",
      )}
    >
      <Icon name="Bot" className="size-3.5" aria-hidden="true" />
      <span className="tabular-nums">{label}</span>
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

export function SubagentPanelSection(props: SubagentViewProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid gap-2 px-3 py-3">
      <div className="grid gap-1">
        <h2 id={headingId} className="text-sm font-medium text-foreground">
          Subagents
        </h2>
        <SubagentCountLine
          summary={props.summary}
          listState={props.listState}
          className="flex-wrap text-xs"
        />
        <SubagentScopeNote {...props} stacked />
      </div>
      <SubagentEmptyOrError {...props} />
      <div className="-mx-1">
        <TaskList {...props} density="row" />
      </div>
    </section>
  );
}
