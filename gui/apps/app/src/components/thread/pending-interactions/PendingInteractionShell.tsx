import { ThreadQuestionFormHost } from "../user-questions/ThreadQuestionFormHost";
import {
  Activity,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { NavLink } from "react-router-dom";
import { Icon } from "@cloudroom/shared-ui/icon";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import { ExpandableLine } from "@/components/ui/expandable-line.js";

export interface PendingInteractionSourceThread {
  href: string;
  title: string;
}

interface PendingInteractionShellProps {
  label: string;
  title?: string;
  initiallyExpanded: boolean;
  errorMessage?: string | null;
  status?: ReactNode;
  summary?: ReactNode;
  footer?: ReactNode;
  children?: (isExpanded: boolean) => ReactNode;
  sourceThread?: PendingInteractionSourceThread;
  testId: string;
}

export function PendingInteractionShell({
  label,
  title,
  initiallyExpanded,
  errorMessage,
  status,
  summary,
  footer,
  children,
  sourceThread,
  testId,
}: PendingInteractionShellProps) {
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const contentId = useId();
  const errorId = useId();
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && isExpanded && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      setIsExpanded(false);
      toggleRef.current?.focus();
    }
  };
  const handleToggle = () => setIsExpanded((value) => !value);
  const toggle = (
    <button
      ref={toggleRef}
      type="button"
      aria-controls={contentId}
      aria-expanded={isExpanded}
      aria-label={isExpanded ? "Hide details" : "Show details"}
      onClick={handleToggle}
      className={cn(
        "flex h-7 shrink-0 items-center justify-center gap-1 rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        summary ? "px-2" : "w-7",
      )}
    >
      {summary ? (
        <span aria-hidden="true">
          {isExpanded ? "Hide details" : "Show details"}
        </span>
      ) : null}
      <Icon
        name="ChevronDown"
        className={cn(
          "size-3.5 transition-transform duration-200",
          isExpanded ? "rotate-180" : undefined,
        )}
      />
    </button>
  );
  const errorNode = errorMessage ? (
    <div
      id={errorId}
      aria-live="polite"
      data-testid="pending-interaction-error"
      className={cn(
        "rounded-md border border-surface-destructive-border bg-surface-destructive px-2 py-1 text-xs text-destructive-text [overflow-wrap:anywhere]",
        summary ? "mt-2" : "mx-3 mb-3",
      )}
    >
      {errorMessage}
    </div>
  ) : null;
  const sourceThreadLink = sourceThread ? (
    <NavLink
      to={sourceThread.href}
      title={sourceThread.title}
      className={cn(
        "min-w-0 truncate text-xs text-subtle-foreground no-underline hover:underline",
        summary ? "mb-1.5 block" : "max-w-[40%] shrink-[3]",
      )}
    >
      From {sourceThread.title}
    </NavLink>
  ) : null;

  return (
    <section
      aria-label={label}
      data-testid={testId}
      data-expanded={isExpanded ? "" : undefined}
      onKeyDown={handleKeyDown}
      className="@container mb-2 min-w-0 max-w-full rounded-lg border border-border bg-surface-recessed text-xs text-muted-foreground"
    >
      <div
        className={cn(
          "flex min-h-9 items-center gap-2 pl-3 pr-1.5",
          isExpanded && !summary
            ? "border-b border-border-hairline py-1.5"
            : "py-1",
        )}
      >
        <button
          type="button"
          aria-controls={contentId}
          aria-expanded={isExpanded}
          aria-label={label}
          aria-describedby={errorMessage ? errorId : undefined}
          onClick={handleToggle}
          className="flex min-h-7 min-w-0 flex-1 items-center rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="flex min-w-0 flex-1 items-start gap-2">
            <span className="flex h-[1lh] shrink-0 items-center text-sm">
              <AttentionDot hasError={Boolean(errorMessage)} />
            </span>
            <span
              title={label}
              className={cn(
                "min-w-0 text-sm text-foreground",
                isExpanded
                  ? "whitespace-normal font-semibold"
                  : "truncate font-medium",
              )}
            >
              {label}
            </span>
          </span>
        </button>
        {status}
        {isExpanded && !summary ? sourceThreadLink : null}
        {toggle}
      </div>
      {summary ? (
        <div className="px-3 pb-3 pt-1">
          {sourceThreadLink}
          {summary}
          {errorNode}
        </div>
      ) : null}
      <Activity mode={isExpanded ? "visible" : "hidden"}>
        <ThreadQuestionFormHost>
          <div
            id={contentId}
            hidden={!isExpanded}
            className={cn(
              "px-3 pb-3",
              summary ? "border-t border-border-hairline pt-2.5" : "pt-2.5",
            )}
          >
            {title ? (
              <h3 className="min-w-0 text-sm font-medium text-foreground">
                <ExpandableLine
                  fullText={title}
                  collapsedClassName="line-clamp-2"
                >
                  {title}
                </ExpandableLine>
              </h3>
            ) : null}
            {children ? (
              <div className={title ? "mt-2" : undefined}>
                {children(isExpanded)}
              </div>
            ) : null}
            {footer ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {footer}
              </div>
            ) : null}
          </div>
        </ThreadQuestionFormHost>
      </Activity>
      {summary ? null : errorNode}
    </section>
  );
}

function AttentionDot({ hasError }: { hasError: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full ring-[3px]",
        hasError
          ? "bg-destructive-text ring-surface-destructive"
          : "bg-attention ring-surface-attention",
      )}
    />
  );
}
