import { cn } from "@cloudroom/shared-ui/lib/utils";
import { useThreadTimeline } from "@/hooks/queries/thread-queries";
import { useEnvironmentPullRequest } from "@/hooks/queries/environment-queries";
import {
  configuredLine,
  FleetStateLabel,
  harnessName,
  locationLine,
} from "./FleetCard";
import {
  formatAge,
  KIND_LABELS,
  stateWord,
  type FleetModel,
  type FleetRedactor,
  type FleetThread,
} from "./fleet-model";

interface FleetInspectorProps {
  thread: FleetThread;
  model: FleetModel;
  redact: FleetRedactor;
  now: number;
  compact: boolean;
  onClose: () => void;
  onOpen: (thread: FleetThread, split: boolean) => void;
  onSelect: (thread: FleetThread) => void;
}

function Row({
  label,
  children,
  source,
}: {
  label: string;
  children: React.ReactNode;
  source?: string;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">
        {children}
        {source ? (
          <span className="ml-1 text-xs text-muted-foreground">· {source}</span>
        ) : null}
      </dd>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-3">
      <h3 className="mb-1 flex items-center gap-2 font-mono text-xs font-semibold tracking-wide text-muted-foreground">
        {title}
        <span aria-hidden="true" className="flex-1 border-t border-border" />
      </h3>
      {children}
    </section>
  );
}

function rootOf(thread: FleetThread, model: FleetModel): FleetThread {
  let current = thread;
  while (current.parentId !== null) {
    const parent = model.byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

function FamilyTree({
  thread,
  model,
  redact,
  onSelect,
}: {
  thread: FleetThread;
  model: FleetModel;
  redact: FleetRedactor;
  onSelect: (thread: FleetThread) => void;
}) {
  const root = rootOf(thread, model);
  const children = new Map<string, FleetThread[]>();
  for (const candidate of model.threads) {
    if (candidate.parentId === null) continue;
    children.set(candidate.parentId, [
      ...(children.get(candidate.parentId) ?? []),
      candidate,
    ]);
  }
  const lines: React.ReactNode[] = [];
  const walk = (
    node: FleetThread,
    prefix: string,
    last: boolean,
    depth: number,
  ) => {
    const word = stateWord(node);
    const kind = KIND_LABELS[node.kind];
    lines.push(
      <li key={node.id} className="min-w-0">
        <button
          type="button"
          onClick={() => onSelect(node)}
          aria-current={node.id === thread.id ? "true" : undefined}
          className={cn(
            "w-full truncate text-left font-mono text-xs hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-foreground",
            node.id === thread.id
              ? "font-semibold text-foreground"
              : "text-foreground/90",
          )}
        >
          <span aria-hidden="true">
            {depth ? `${prefix}${last ? "└─ " : "├─ "}` : ""}
          </span>
          {redact.title(node)}
        </button>
        <div className="truncate font-mono text-xs text-muted-foreground">
          <span aria-hidden="true">
            {depth ? `${prefix}${last ? "   " : "│  "}` : ""}
          </span>
          {kind ? `${kind} · ` : ""}
          <span aria-hidden="true">{word.glyph} </span>
          {word.word}
        </div>
      </li>,
    );
    const kids = children.get(node.id) ?? [];
    kids.forEach((child, index) =>
      walk(
        child,
        depth ? `${prefix}${last ? "   " : "│  "}` : "",
        index === kids.length - 1,
        depth + 1,
      ),
    );
  };
  walk(root, "", true, 0);
  return <ul className="space-y-0.5">{lines}</ul>;
}

export function FleetInspector({
  thread,
  model,
  redact,
  now,
  compact,
  onClose,
  onOpen,
  onSelect,
}: FleetInspectorProps) {
  const timeline = useThreadTimeline(thread.id, { enabled: !thread.archived });
  const pullRequest = useEnvironmentPullRequest(thread.entry.environmentId, {
    enabled: !thread.archived,
  });
  const pending = model.pendingFields;
  const configured = configuredLine(thread, pending.has("configuredExecution"));
  const fallback = timeline.data?.modelFallback ?? null;
  const todos = timeline.data?.pendingTodos ?? null;
  const context = timeline.data?.contextWindowUsage ?? null;
  const kind = KIND_LABELS[thread.kind];
  const parent = thread.parentId ? model.byId.get(thread.parentId) : undefined;
  const sandbox = thread.fields?.cloudSandbox ?? null;
  const pr =
    pullRequest.data?.outcome === "available"
      ? pullRequest.data.pullRequest
      : null;

  return (
    <aside
      aria-label="Thread details"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-background",
        compact
          ? "fixed inset-x-0 bottom-0 z-40 max-h-[85dvh] rounded-t-2xl border-t border-border shadow-2xl"
          : "w-[360px] shrink-0 border-l border-border-seam",
      )}
    >
      <div className="flex min-h-11 items-center justify-between gap-2 px-4 pt-2">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {redact.project(thread.projectId, thread.projectName)} ›{" "}
          {thread.id.slice(0, 10)}…{kind ? ` · ${kind}` : ""}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="min-h-11 min-w-11 rounded border border-border px-2 text-sm hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-foreground"
        >
          ✕{compact ? "" : " Esc"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <h2
          className={cn(
            "mt-1 text-base font-semibold leading-snug text-foreground",
            redact.on && "italic text-muted-foreground",
          )}
        >
          {redact.title(thread)}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <FleetStateLabel thread={thread} />
          {redact.text(
            thread.fields?.inputSummary ??
              thread.fields?.lastErrorSummary ??
              thread.fields?.latestActivityLabel ??
              null,
          ) ? (
            <span className="text-sm text-muted-foreground">
              {redact.text(
                thread.fields?.inputSummary ??
                  thread.fields?.lastErrorSummary ??
                  thread.fields?.latestActivityLabel ??
                  null,
              )}
            </span>
          ) : null}
        </div>
        {thread.entry.purpose?.text && !redact.on ? (
          <p className="mt-1 text-xs text-muted-foreground">
            AI summary (may be wrong): {thread.entry.purpose.text}
          </p>
        ) : null}

        <Section title="STATE">
          <dl className="grid grid-cols-[112px_1fr] gap-x-2 gap-y-1 text-sm">
            <Row label="Thread" source="thread">
              {thread.archived
                ? "Archived"
                : thread.entry.status === "active"
                  ? "Working"
                  : thread.entry.status === "error"
                    ? "Error"
                    : thread.entry.status === "idle"
                      ? "Idle (not completed)"
                      : thread.entry.status}
            </Row>
            <Row
              label="Input request"
              source={
                pending.has("inputRequest") ? "kind not reported" : "thread"
              }
            >
              {thread.entry.hasPendingInteraction
                ? thread.fields?.inputKind === "approval"
                  ? "Approval requested"
                  : thread.fields?.inputKind === "question"
                    ? "Question asked"
                    : "Input requested"
                : "None"}
            </Row>
            <Row label="Connection" source="host link">
              {thread.runtime === "offline"
                ? "Host offline"
                : thread.runtime === "reconnecting"
                  ? "Reconnecting"
                  : thread.runtime === "starting"
                    ? "Starting"
                    : "Connected"}
            </Row>
            {thread.location.kind === "cloud" ? (
              <Row
                label="Sandbox"
                source={
                  pending.has("cloudSandboxState")
                    ? "not reported by this server"
                    : sandbox?.lastCheckError
                      ? `check error: ${sandbox.lastCheckError}`
                      : sandbox?.lastSuccessfulCheckAt
                        ? `checked ${formatAge(now - sandbox.lastSuccessfulCheckAt)}`
                        : undefined
                }
              >
                {thread.sandbox === "awake"
                  ? "Awake"
                  : thread.sandbox === "not-awake"
                    ? "Not awake"
                    : "Unknown"}{" "}
                <span className="text-muted-foreground">
                  (sandbox, not runtime)
                </span>
              </Row>
            ) : null}
            <Row label="Queue" source="thread list">
              {thread.entry.queuedWork === "failed"
                ? "▲ Queued message failed"
                : thread.entry.queuedWork === "waiting"
                  ? "Message waiting"
                  : "Empty"}
            </Row>
            <Row label="Updated" source="realtime">
              {formatAge(now - thread.entry.updatedAt)}
            </Row>
          </dl>
        </Section>

        <Section title="EXECUTION">
          <dl className="grid grid-cols-[112px_1fr] gap-x-2 gap-y-1 text-sm">
            <Row label="Harness">{harnessName(thread.entry.providerId)}</Row>
            <Row
              label="Model · effort"
              source={
                pending.has("configuredExecution")
                  ? "not reported by this server"
                  : "configured"
              }
            >
              {configured.model} · {configured.effort}
            </Row>
            <Row label="Served by" source="thread history">
              {fallback
                ? `Fallback to ${fallback.fallbackModel} (from ${fallback.originalModel})`
                : timeline.isLoading
                  ? "Loading…"
                  : "No fallback seen in loaded turns"}
            </Row>
            <Row label="In-turn" source="activity, not threads">
              {thread.inTurnSubagents > 0
                ? `${thread.inTurnSubagents} subagents running`
                : "None running"}
            </Row>
            <Row label="Location">
              {locationLine(
                thread,
                redact,
                now,
                pending.has("cloudSandboxState"),
              )}
              {thread.entry.environmentBranchName && !redact.on ? (
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {thread.entry.environmentBranchName}
                </span>
              ) : null}
            </Row>
          </dl>
        </Section>

        <Section title="WORK">
          <dl className="grid grid-cols-[112px_1fr] gap-x-2 gap-y-1 text-sm">
            <Row label="Pull request" source={pr ? "workspace PR" : undefined}>
              {thread.archived
                ? "Not loaded for archived threads"
                : pullRequest.isLoading
                  ? "Loading…"
                  : pr
                    ? `#${pr.number} ${pr.state} · ${pr.checks.pendingCount} checks pending, ${pr.checks.passedCount} passed`
                    : "None found for this branch"}
            </Row>
            <Row
              label="Todo list"
              source={todos ? "agent-reported" : undefined}
            >
              {timeline.isLoading
                ? "Loading…"
                : todos
                  ? `${todos.items.filter((item) => item.status === "completed").length} of ${todos.items.length} marked done`
                  : "No todo list"}
            </Row>
            <Row label="Context" source={context ? "at last turn" : undefined}>
              {timeline.isLoading
                ? "Loading…"
                : context
                  ? `${Math.round((context.usedTokens / context.modelContextWindow) * 100)}% of ${Math.round(context.modelContextWindow / 1000)}k${context.estimated ? " (estimated)" : ""}`
                  : "Not reported"}
            </Row>
          </dl>
        </Section>

        <Section title="FAMILY">
          {thread.parentStatus === "unknown" ? (
            <p className="mb-1 text-xs text-muted-foreground">
              Parent unknown: this source does not link it to a thread.
            </p>
          ) : null}
          {parent ||
          model.threads.some(
            (candidate) => candidate.parentId === thread.id,
          ) ? (
            <FamilyTree
              thread={thread}
              model={model}
              redact={redact}
              onSelect={onSelect}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No parent or child threads.
            </p>
          )}
        </Section>
      </div>
      <div
        className={cn(
          "flex gap-2 border-t border-border-seam px-4 py-3",
          compact && "pb-8",
        )}
      >
        <button
          type="button"
          onClick={() => onOpen(thread, false)}
          className="min-h-11 flex-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          Open thread{compact ? "" : " ↵"}
        </button>
        {compact ? (
          parent ? (
            <button
              type="button"
              onClick={() => onSelect(parent)}
              className="min-h-11 rounded-md border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-foreground"
            >
              Parent
            </button>
          ) : null
        ) : (
          <button
            type="button"
            onClick={() => onOpen(thread, true)}
            className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-foreground"
          >
            Open in split ⌘↵
          </button>
        )}
      </div>
    </aside>
  );
}
