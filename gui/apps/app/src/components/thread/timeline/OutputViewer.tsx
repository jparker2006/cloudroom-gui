import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@cloudroom/shared-ui/button";
import { PersistentResponsiveDrawerShell } from "@cloudroom/shared-ui/responsive-overlay";
import { TerminalOutputBlock, terminalOutputHtml } from "./TerminalOutputBlock";
import { ToolCallDetailBlock } from "./ToolCallDetailBlock";
import {
  escapedOutputHtml,
  searchOutputHtml,
  mapOutputAnchor,
  MAX_OUTPUT_HIGHLIGHTS,
  outputMatchContext,
} from "./output-search";
import {
  useTimelineWorkRowFullOutput,
  type TimelinePreviewableWorkRow,
  type TimelineWorkRowFullOutput,
} from "./useTimelineWorkRowFullOutput";

export type OutputViewerDirection = "reader" | "indexed";

export function outputCoverage(
  row: TimelinePreviewableWorkRow,
  full: TimelineWorkRowFullOutput,
) {
  const loaded = `${full.output.length.toLocaleString()} raw characters loaded`;
  switch (full.state) {
    case "unavailable-preview":
      return `Output details unavailable · ${loaded}. Search covers the loaded preview only; no detail reference is available.`;
    case "idle-preview":
      return `Limited inline preview · ${loaded}. Open output to request available details.`;
    case "streaming-preview":
      return `Streaming · limited preview · ${loaded}. Search covers this loaded preview only.`;
    case "loading":
      return `Loading available output · ${loaded}. Search covers the loaded preview while loading.`;
    case "limited-preview":
      return `Limited preview · ${loaded}. Detail response limit reached; omitted output is not searchable.`;
    case "expired-preview":
      return `Retention expired · ${loaded}. Only the retained preview can be searched; discarded output cannot be recovered.`;
    case "error":
      return `Load failed · ${loaded}. Search covers the loaded preview only.`;
    case "complete":
    case "loaded":
      return row.status === "pending"
        ? `Streaming · ${loaded}. Search covers output received so far.`
        : `Complete available output · ${loaded}. Search covers all loaded output.`;
  }
}

interface OutputViewerProps {
  row: TimelinePreviewableWorkRow;
  direction: OutputViewerDirection;
  fullOutput: TimelineWorkRowFullOutput;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OutputViewer({
  row,
  direction,
  fullOutput,
  open,
  onOpenChange,
}: OutputViewerProps) {
  const titleId = useId();
  const scopeId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [following, setFollowing] = useState(false);
  const [railPage, setRailPage] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const pendingNavigation = useRef<number | null>(null);
  const snapshot = useRef({ top: 0, left: 0, offset: 0, line: 0, within: 0 });
  const previousText = useRef<string | null>(null);
  const sourceHtml = useMemo(
    () =>
      row.workKind === "command"
        ? terminalOutputHtml(fullOutput.output)
        : escapedOutputHtml(fullOutput.output),
    [fullOutput.output, row.workKind],
  );
  const rendered = useMemo(
    () => searchOutputHtml(sourceHtml, query, active),
    [sourceHtml, query, active],
  );
  const coverage = outputCoverage(row, fullOutput);
  const count = rendered.matches.length;
  const selected =
    active === null || count === 0 ? null : Math.min(active, count - 1);
  const visibleRailPage = Math.min(
    railPage,
    Math.max(0, Math.ceil(count / 50) - 1),
  );
  const rememberPosition = () => {
    const element = scroller.current;
    const content = pre.current;
    if (!element || !content) return;
    const lineHeight = parseFloat(getComputedStyle(content).lineHeight) || 20;
    const contentTop =
      content.getBoundingClientRect().top -
      element.getBoundingClientRect().top +
      element.scrollTop;
    const offset = element.scrollTop - contentTop;
    const line = Math.max(0, Math.floor(offset / lineHeight));
    snapshot.current = {
      top: element.scrollTop,
      left: element.scrollLeft,
      line,
      within: offset - line * lineHeight,
      offset: rendered.text
        .split("\n")
        .slice(0, line)
        .reduce((sum, value) => sum + value.length + 1, 0),
    };
  };
  const scrollToMatch = (index: number) => {
    const element = scroller.current;
    const target = element?.querySelector<HTMLElement>(
      `[data-output-match="${index}"]`,
    );
    if (!element || !target) return false;
    const box = target.getBoundingClientRect();
    const viewport = element.getBoundingClientRect();
    element.scrollTop += box.top - viewport.top - element.clientHeight / 3;
    element.scrollLeft +=
      box.left < viewport.left || box.right > viewport.right
        ? box.left - viewport.left - 24
        : 0;
    rememberPosition();
    return true;
  };
  useLayoutEffect(() => {
    const element = scroller.current;
    const content = pre.current;
    if (!element || !content) return;
    if (following) element.scrollTop = element.scrollHeight;
    else {
      const saved = snapshot.current;
      const found =
        previousText.current === null
          ? null
          : mapOutputAnchor(previousText.current, rendered.text, saved.offset);
      const line =
        found === null
          ? saved.line
          : rendered.text.slice(0, found).split("\n").length - 1;
      const lineHeight = parseFloat(getComputedStyle(content).lineHeight) || 20;
      const contentTop =
        content.getBoundingClientRect().top -
        element.getBoundingClientRect().top +
        element.scrollTop;
      element.scrollTop =
        found === null
          ? saved.top
          : contentTop + line * lineHeight + saved.within;
      element.scrollLeft = saved.left;
    }
    previousText.current = rendered.text;
    rememberPosition();
  }, [fullOutput.output, following, rendered.text]);
  useLayoutEffect(() => {
    scroller.current
      ?.querySelectorAll<HTMLElement>("[data-output-match]")
      .forEach((mark) => {
        mark.dataset.active = String(
          Number(mark.dataset.outputMatch) === selected,
        );
      });
    if (
      pendingNavigation.current !== null &&
      scrollToMatch(pendingNavigation.current)
    )
      pendingNavigation.current = null;
  }, [rendered.html, selected]);
  const navigate = (index: number) => {
    if (count === 0) return;
    setFollowing(false);
    const next = (index + count) % count;
    setActive(next);
    setRailPage(Math.floor(next / 50));
    pendingNavigation.current = scrollToMatch(next) ? null : next;
  };
  const output = (
    <pre
      ref={pre}
      className="m-0 w-max min-w-full whitespace-pre font-mono text-xs leading-5 text-muted-foreground"
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
  return (
    <PersistentResponsiveDrawerShell
      open={open}
      onOpenChange={onOpenChange}
      labelledBy={titleId}
      describedBy={scopeId}
      contentClassName={`h-[88dvh] overflow-hidden pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:mt-0 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl sm:shadow-2xl sm:[--bb-drawer-closed-offset:2rem] ${direction === "indexed" ? "sm:w-[min(1100px,calc(100vw-2rem))]" : "sm:w-[min(820px,calc(100vw-2rem))]"}`}
    >
      <header className="shrink-0 space-y-3 border-b px-4 pb-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">
              {row.workKind === "command" ? "Command output" : "Tool output"} ·{" "}
              {direction === "reader" ? "A / Reader" : "B / Match index"}
            </p>
            <h2 id={titleId} className="text-lg font-semibold">
              Inspect output
            </h2>
          </div>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
        <p id={scopeId} role="status" className="text-xs text-muted-foreground">
          {coverage}
        </p>
        {fullOutput.state === "error" ? (
          <div
            role="alert"
            className="flex items-center gap-3 text-sm text-destructive"
          >
            Available output could not be loaded.
            <Button variant="outline" onClick={fullOutput.retry}>
              Retry
            </Button>
          </div>
        ) : null}
        <div
          className="flex flex-wrap items-center gap-2"
          role="search"
          aria-label="Search loaded output"
        >
          <input
            type="search"
            aria-label="Search loaded output"
            aria-describedby={scopeId}
            placeholder="Find in loaded output…"
            value={query}
            className="h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-base sm:text-sm"
            onChange={(event) => {
              rememberPosition();
              setFollowing(false);
              setQuery(event.target.value);
              setActive(null);
              setRailPage(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                navigate(
                  selected === null
                    ? event.shiftKey
                      ? count - 1
                      : 0
                    : selected + (event.shiftKey ? -1 : 1),
                );
              }
            }}
          />
          <Button
            variant="outline"
            className="h-11 min-w-11"
            aria-label="Previous match"
            disabled={!count}
            onClick={() =>
              navigate(selected === null ? count - 1 : selected - 1)
            }
          >
            ↑
          </Button>
          <Button
            variant="outline"
            className="h-11 min-w-11"
            aria-label="Next match"
            disabled={!count}
            onClick={() => navigate(selected === null ? 0 : selected + 1)}
          >
            ↓
          </Button>
          <Button
            variant="ghost"
            className="h-11"
            disabled={!query}
            onClick={() => {
              rememberPosition();
              setQuery("");
              setActive(null);
            }}
          >
            Clear
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span aria-live="polite" data-output-count>
            {query
              ? `${selected === null ? 0 : selected + 1} of ${count.toLocaleString()} matches in loaded output`
              : "Literal search · case insensitive · output only"}
          </span>
          <span className="hidden sm:inline">
            Enter / Shift+Enter to navigate
          </span>
        </div>
        {count > MAX_OUTPUT_HIGHLIGHTS ? (
          <p className="text-xs text-muted-foreground">
            All loaded matches counted. Dense results: highlighting follows
            match navigation.
          </p>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {direction === "indexed" && query ? (
          <aside
            aria-label="Matching lines"
            className="w-28 shrink-0 overflow-y-auto border-r bg-surface-recessed p-2 sm:w-60"
          >
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Matching lines
            </p>
            {Array.from(
              rendered.matches.subarray(
                visibleRailPage * 50,
                visibleRailPage * 50 + 50,
              ),
              (start, offset) => {
                const match = outputMatchContext(
                  rendered.text,
                  start,
                  rendered.ends[visibleRailPage * 50 + offset]!,
                );
                return (
                  <button
                    type="button"
                    key={visibleRailPage * 50 + offset}
                    onClick={() => navigate(visibleRailPage * 50 + offset)}
                    aria-current={
                      selected === visibleRailPage * 50 + offset
                        ? "true"
                        : undefined
                    }
                    className="mb-1 block min-h-11 w-full rounded-md px-2 py-2 text-left text-xs hover:bg-muted aria-[current=true]:bg-muted"
                  >
                    <span className="text-muted-foreground">
                      Line {match.line.toLocaleString()}
                    </span>
                    <span className="mt-1 block truncate font-mono">
                      {match.excerpt}
                    </span>
                  </button>
                );
              },
            )}
            {count > 50 ? (
              <div className="space-y-2 text-xs">
                <p>
                  Matches {visibleRailPage * 50 + 1}–
                  {Math.min(count, visibleRailPage * 50 + 50)} of {count}
                </p>
                <Button
                  variant="outline"
                  disabled={visibleRailPage === 0}
                  onClick={() => setRailPage(visibleRailPage - 1)}
                >
                  Back
                </Button>
                <Button
                  variant="outline"
                  disabled={(visibleRailPage + 1) * 50 >= count}
                  onClick={() => setRailPage(visibleRailPage + 1)}
                >
                  More
                </Button>
              </div>
            ) : null}
          </aside>
        ) : null}
        <div
          ref={scroller}
          role="region"
          aria-label="Loaded output"
          tabIndex={0}
          data-output-scroll
          className="min-w-0 flex-1 touch-pan-x touch-pan-y overflow-auto overscroll-contain p-3 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring sm:p-5"
          style={{ overflowAnchor: "none" }}
          onScroll={rememberPosition}
          onWheel={() => setFollowing(false)}
          onPointerDown={() => setFollowing(false)}
          onTouchStart={() => setFollowing(false)}
          onKeyDown={(event) => {
            if (
              [
                "ArrowUp",
                "ArrowDown",
                "PageUp",
                "PageDown",
                "Home",
                "End",
                " ",
              ].includes(event.key)
            )
              setFollowing(false);
          }}
        >
          {row.workKind === "command" ? (
            <TerminalOutputBlock
              commandLine={`$ ${row.command}`}
              metadataLines={row.source ? [`source: ${row.source}`] : []}
              exitCode={row.exitCode}
              streaming={false}
              output=""
              viewerContent={output}
            />
          ) : (
            <ToolCallDetailBlock
              toolName={row.toolName}
              args={row.toolArgs}
              streaming={false}
              output=""
              viewerContent={output}
            />
          )}
        </div>
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
        <span>
          {row.status === "pending"
            ? following
              ? "Following live output"
              : "Reading position held"
            : "Available output · reading position held"}
        </span>
        <Button
          variant="outline"
          onClick={() => {
            setQuery("");
            setActive(null);
            setFollowing(row.status === "pending");
            requestAnimationFrame(() => {
              const element = scroller.current;
              if (element) {
                element.scrollTop = element.scrollHeight;
                rememberPosition();
              }
            });
          }}
        >
          {row.status === "pending" ? "Follow live" : "Jump to end"}
        </Button>
      </footer>
    </PersistentResponsiveDrawerShell>
  );
}

export function PreviewableOutputBody({
  row,
  direction,
}: {
  row: TimelinePreviewableWorkRow;
  direction: OutputViewerDirection;
}) {
  const [open, setOpen] = useState(false);
  const fullOutput = useTimelineWorkRowFullOutput(row, { enabled: open });
  return (
    <div className="space-y-1">
      <div className="[&_[data-detail-scroll-area]]:max-h-24">
        {row.workKind === "command" ? (
          <TerminalOutputBlock
            commandLine={`$ ${row.command}`}
            metadataLines={row.source ? [`source: ${row.source}`] : []}
            output={row.output}
            exitCode={row.exitCode}
            streaming={false}
          />
        ) : (
          <ToolCallDetailBlock
            toolName={row.toolName}
            args={row.toolArgs}
            output={row.output}
            streaming={false}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {row.status === "pending"
            ? "Streaming"
            : row.outputPreview
              ? "Limited inline preview"
              : "Available output"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          Open output
        </Button>
      </div>
      <OutputViewer
        row={row}
        direction={direction}
        fullOutput={fullOutput}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}
