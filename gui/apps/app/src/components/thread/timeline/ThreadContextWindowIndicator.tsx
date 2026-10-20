import { useId, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@cloudroom/shared-ui/popover";
import type {
  RecordedCompactionsSummary,
  ThreadContextWindowUsage,
} from "@cloudroom/server-contract";
import { useHoverPopover } from "../../ui/hooks/use-hover-popover.js";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import {
  calculateContextWindowUsagePercent,
  formatCompactTokenCount,
} from "./thread-context-window-usage.js";

import {
  ContextWindowReveal,
  ThreadContextWindowDetails,
  ThreadContextWindowSegments,
} from "./ThreadContextWindowDetails.js";
import {
  RecordedCompactionsSection,
  recordedCompactionsCountLabel,
} from "./RecordedCompactionsSection.js";

interface ThreadContextWindowCardProps {
  usage: ThreadContextWindowUsage | null;
  note?: string | undefined;
  expanded?: boolean;
  className?: string;
  compactions?: RecordedCompactionsSummary | null;
  threadId?: string | undefined;
  open?: boolean;
}

interface ThreadContextWindowIndicatorProps {
  usage: ThreadContextWindowUsage | null;
  note?: string | undefined;
  defaultOpen?: boolean;
  compactions?: RecordedCompactionsSummary | null;
  threadId?: string | undefined;
}

function usageToneClass(usedPercent: number | null): string {
  if (usedPercent === null) return "text-muted-foreground";
  return usedPercent >= 90
    ? "text-destructive"
    : usedPercent >= 75
      ? "text-warning-text"
      : "text-muted-foreground";
}

function usageTokensLabel(usage: ThreadContextWindowUsage | null): string {
  if (usage === null) return "Token count not reported";
  return `${formatCompactTokenCount(usage.usedTokens)} / ${formatCompactTokenCount(usage.modelContextWindow)} tokens`;
}

const CONTEXT_WINDOW_POPOVER_CLOSE_DELAY_MS = 60;
function ThreadContextWindowHistory({
  history,
  modelContextWindow,
  autoCompactAtTokens,
}: {
  history: readonly number[];
  modelContextWindow: number;
  autoCompactAtTokens: number | null | undefined;
}) {
  const height = (tokens: number) =>
    `${Math.min(Math.max((tokens / modelContextWindow) * 100, 3), 100)}%`;
  return (
    <div aria-hidden="true" className="relative flex h-12 items-end gap-px">
      {autoCompactAtTokens ? (
        <div
          className="absolute inset-x-0 border-t border-dashed border-muted-foreground/50"
          style={{ bottom: height(autoCompactAtTokens) }}
        />
      ) : null}
      {history.map((tokens, index) => (
        <div
          key={index}
          className={cn(
            "flex-1 rounded-[1px]",
            index === history.length - 1
              ? "bg-foreground"
              : "bg-muted-foreground/45",
          )}
          style={{ height: height(tokens) }}
        />
      ))}
    </div>
  );
}

export function ThreadContextWindowCard({
  usage,
  note,
  expanded = false,
  className,
  compactions,
  threadId,
  open = true,
}: ThreadContextWindowCardProps) {
  const details = usage?.snapshot?.categories.length
    ? usage.snapshot
    : undefined;
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const detailsId = useId();
  const usedPercent = calculateContextWindowUsagePercent(usage);
  const visualPercent =
    usedPercent === null ? 0 : Math.min(Math.max(usedPercent, 0), 100);
  const toneClass = usageToneClass(usedPercent);
  const titleLabel = usage?.estimated ? "Estimated context" : "Context window";
  const history = usage?.history ?? [];
  const modelContextWindow = usage?.modelContextWindow ?? null;
  const showHistory =
    expanded &&
    history.length >= 2 &&
    !detailsExpanded &&
    modelContextWindow !== null;
  const showCompactions = compactions !== undefined;

  return (
    <div
      className={cn(
        "@container/context-window w-56 rounded-md border bg-popover p-2 text-popover-foreground shadow-md max-md:px-4",
        showCompactions && "w-90",
        details &&
          "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        details && detailsExpanded && "w-90",
        className,
      )}
    >
      <div className="flex flex-col gap-2 max-md:gap-3">
        <div className="flex items-baseline justify-between gap-2 text-xs max-md:text-sm">
          <span
            className={cn(
              "text-muted-foreground",
              details && detailsExpanded && "font-medium text-foreground",
            )}
          >
            {titleLabel}
          </span>
          <span className={cn("font-medium tabular-nums", toneClass)}>
            {usedPercent === null
              ? "Usage not reported"
              : `${usedPercent}% used`}
          </span>
        </div>
        {showHistory && modelContextWindow !== null ? (
          <ThreadContextWindowHistory
            history={history}
            modelContextWindow={modelContextWindow}
            autoCompactAtTokens={usage?.snapshot?.autoCompactAtTokens}
          />
        ) : null}
        <div
          className={cn(
            showHistory && "hidden",
            "relative h-1.5 w-full overflow-hidden rounded-full bg-border transition-[height] duration-200 motion-reduce:transition-none max-md:h-2",
            usedPercent === null &&
              "border border-dashed border-border bg-transparent",
            details && detailsExpanded && "order-2 h-4 max-md:h-5",
          )}
        >
          <div
            className={cn(
              "h-full rounded-full bg-current transition-opacity duration-200 ease-out motion-reduce:transition-none",
              toneClass,
              details && detailsExpanded && "opacity-0",
            )}
            style={{ width: `${visualPercent}%` }}
          />
          {details && modelContextWindow !== null ? (
            <ThreadContextWindowSegments
              details={details}
              modelContextWindow={modelContextWindow}
              visible={detailsExpanded}
            />
          ) : null}
        </div>
        <div
          className={cn(
            "flex items-baseline justify-between gap-2 text-xs tabular-nums text-muted-foreground max-md:text-sm",
            details && detailsExpanded && "order-1",
          )}
        >
          <span
            className={cn(
              details && detailsExpanded && "font-medium text-foreground",
            )}
          >
            {usageTokensLabel(usage)}
          </span>
          <span>
            {showHistory
              ? `${history.length} turns`
              : usedPercent === null
                ? null
                : `${Math.max(0, 100 - usedPercent)}% left`}
          </span>
        </div>
        {note ? (
          <p className="text-xs text-muted-foreground max-md:text-sm">{note}</p>
        ) : null}
      </div>
      {details ? (
        <>
          <div className="-mx-2 max-md:-mx-4">
            <ContextWindowReveal id={detailsId} open={detailsExpanded}>
              <ThreadContextWindowDetails
                details={details}
                capacity={modelContextWindow ?? details.contextWindowTokens}
              />
            </ContextWindowReveal>
          </div>
          <button
            type="button"
            className="ml-auto mt-2 flex cursor-pointer items-center gap-1.5 rounded-xs text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:mt-3 max-md:min-h-11 max-md:text-sm"
            aria-expanded={detailsExpanded}
            aria-controls={detailsId}
            onClick={() => setDetailsExpanded((value) => !value)}
          >
            {detailsExpanded ? "Hide details" : "Show details"}
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              aria-hidden="true"
              data-icon-root=""
              className={cn(
                "size-3 transition-transform duration-200 ease-out motion-reduce:transition-none",
                detailsExpanded && "rotate-180",
              )}
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
          </button>
        </>
      ) : null}
      {showCompactions ? (
        <RecordedCompactionsSection
          summary={compactions}
          threadId={threadId}
          open={open}
        />
      ) : null}
    </div>
  );
}

export function ThreadContextWindowIndicator({
  usage,
  note,
  defaultOpen,
  compactions,
  threadId,
}: ThreadContextWindowIndicatorProps) {
  const details = usage?.snapshot?.categories.length
    ? usage.snapshot
    : undefined;
  const hoverableContent = details !== undefined || compactions !== undefined;
  const {
    open: hoverOpen,
    triggerHoverProps,
    contentHoverProps,
    handleOpenChange,
  } = useHoverPopover({
    closeDelayMs: hoverableContent
      ? 200
      : CONTEXT_WINDOW_POPOVER_CLOSE_DELAY_MS,
    hoverableContent,
  });
  const [pinned, setPinned] = useState(false);
  const open = defaultOpen || hoverOpen || pinned;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const tabbables = () =>
    [
      ...(contentRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
      ) ?? []),
    ].filter((element) => element.closest("[inert]") === null);
  const focusContent = () => {
    setPinned(true);
    requestAnimationFrame(() =>
      (tabbables()[0] ?? contentRef.current)?.focus(),
    );
  };

  const usedPercent = calculateContextWindowUsagePercent(usage);
  const visualPercent =
    usedPercent === null ? 0 : Math.min(Math.max(usedPercent, 0), 100);

  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - visualPercent / 100);

  const toneClass = usageToneClass(usedPercent);

  const titleLabel = usage?.estimated ? "Estimated context" : "Context window";
  const ariaLabel = [
    usedPercent === null
      ? "Context usage not reported"
      : `Context window ${usedPercent}% used`,
    compactions === undefined
      ? null
      : `recorded compactions: ${recordedCompactionsCountLabel(compactions)}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setPinned(false);
        handleOpenChange(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          {...triggerHoverProps}
          ref={triggerRef}
          onClick={(event) => {
            event.preventDefault();
            if (!pinned && event.detail === 0) {
              focusContent();
              return;
            }
            setPinned((value) => !value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            focusContent();
          }}
          className="-m-1 inline-flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={ariaLabel}
          aria-keyshortcuts="Enter ArrowDown"
        >
          <svg
            viewBox="0 0 16 16"
            className={cn("size-4", toneClass)}
            aria-hidden="true"
          >
            <circle
              cx="8"
              cy="8"
              r={radius}
              fill="none"
              strokeWidth="3"
              className="stroke-border-hairline"
              strokeDasharray={usedPercent === null ? "2 2" : undefined}
            />
            {usedPercent === null ? null : (
              <circle
                cx="8"
                cy="8"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 8 8)"
              />
            )}
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        {...contentHoverProps}
        onEscapeKeyDown={() => {
          if (contentRef.current?.contains(document.activeElement)) {
            triggerRef.current?.focus();
          }
        }}
        mobileTitle={titleLabel}
        className="w-auto border-0 bg-transparent p-0 shadow-none max-md:p-0"
      >
        <div
          ref={contentRef}
          tabIndex={-1}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const elements = tabbables();
            const edge = event.shiftKey
              ? elements[0]
              : elements[elements.length - 1];
            const atEdge =
              document.activeElement === contentRef.current
                ? event.shiftKey || elements.length === 0
                : document.activeElement === edge;
            if (!atEdge) return;
            event.preventDefault();
            if (!event.shiftKey) setPinned(false);
            triggerRef.current?.focus();
          }}
        >
          <ThreadContextWindowCard
            usage={usage}
            note={note}
            expanded={pinned}
            compactions={compactions}
            threadId={threadId}
            open={open}
            className="max-md:w-full max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-4 max-md:pt-2 max-md:pb-[max(1rem,env(safe-area-inset-bottom))] max-md:shadow-none"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
