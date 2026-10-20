import { createContext, useContext } from "react";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import {
  familyCounts,
  KIND_LABELS,
  sandboxWord,
  stateWord,
  type FleetFamily,
  type FleetRedactor,
  type FleetThread,
} from "./fleet-model";

const TONE_CLASS = {
  warn: "text-warning-text",
  error: "text-destructive-text",
  offline: "text-foreground",
  busy: "text-primary-text",
  idle: "text-muted-foreground",
  new: "text-foreground",
} as const;

export interface FleetProviderPresentation {
  name: string;
  glyph: string | null;
}

export type FleetProviders = ReadonlyMap<string, FleetProviderPresentation>;

export const FleetProvidersContext = createContext<FleetProviders>(new Map());

export function harnessName(
  providerId: string,
  providers: FleetProviders,
): string {
  return providers.get(providerId)?.name ?? providerId;
}

export function effortWord(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === "xhigh") return "X-High";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function FleetStateLabel({
  thread,
  className,
}: {
  thread: FleetThread;
  className?: string;
}) {
  const word = stateWord(thread);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wide whitespace-nowrap",
        TONE_CLASS[word.tone],
        className,
      )}
    >
      <span aria-hidden="true">{word.glyph}</span>
      {word.word}
    </span>
  );
}

export function configuredLine(
  thread: FleetThread,
  pending: boolean,
  loading = false,
): { model: string; effort: string } {
  if (loading && thread.fields === null)
    return { model: "model loading…", effort: "effort loading…" };
  if (pending)
    return { model: "model not reported", effort: "effort not reported" };
  return {
    model: thread.fields?.configuredModel ?? "model unknown",
    effort: effortWord(thread.fields?.configuredReasoning) ?? "effort unknown",
  };
}

export function locationLine(
  thread: FleetThread,
  redact: FleetRedactor,
  now: number,
  sandboxPending: boolean,
): string {
  if (thread.location.kind === "cloud") {
    if (sandboxPending) return "☁ Cloud · sleep state not reported";
    return `☁ ${sandboxWord(thread, now) ?? "Cloud"}`;
  }
  const name =
    redact.host(thread.location.hostId, thread.location.hostName) ??
    "Unknown machine";
  const online =
    thread.location.online === null
      ? "status unknown"
      : thread.location.online
        ? "online"
        : "offline";
  return `▭ ${online} · ${name}`;
}

function reasonText(
  thread: FleetThread,
  redact: FleetRedactor,
  pendingInput: boolean,
): string | null {
  const fields = thread.fields;
  if (thread.runtime === "input")
    return (
      redact.text(fields?.inputSummary ?? null) ??
      (pendingInput ? "Request details not reported" : null)
    );
  if (thread.runtime === "error")
    return (
      redact.text(fields?.lastErrorSummary ?? null) ??
      (fields === null ? "Error details not reported" : null)
    );
  if (thread.runtime === "offline")
    return `${redact.host(thread.location.hostId, thread.location.hostName) ?? "Host"} is offline`;
  if (thread.runtime === "reconnecting") return "Reconnecting to host";
  if (thread.runtime === "starting")
    return thread.location.kind === "cloud" ? "Starting sandbox" : "Starting";
  if (fields?.fallbackModel)
    return `Fallback to ${fields.fallbackModel} seen on last turn`;
  return redact.text(fields?.latestActivityLabel ?? null);
}

export function cardAccessibleName(
  thread: FleetThread,
  redact: FleetRedactor,
  parent: FleetThread | undefined,
  now: number,
  pending: ReadonlySet<string>,
  providers: FleetProviders,
): string {
  const kind = KIND_LABELS[thread.kind];
  const configured = configuredLine(
    thread,
    pending.has("configuredExecution"),
    pending.has("loading"),
  );
  return [
    redact.title(thread),
    stateWord(thread).word,
    reasonText(thread, redact, pending.has("inputRequest")),
    kind
      ? `${kind}${thread.parentStatus === "known" && parent ? ` of ${redact.title(parent)}` : thread.parentStatus === "unknown" ? ", parent unknown" : thread.parentStatus === "archived" ? ", parent archived" : ""}`
      : null,
    `${harnessName(thread.entry.providerId, providers)}, configured ${configured.model}, ${configured.effort}`,
    locationLine(thread, redact, now, pending.has("cloudSandboxState")),
    `updated ${new Date(thread.entry.updatedAt).toLocaleTimeString()}`,
  ]
    .filter(Boolean)
    .join(". ");
}

export interface FleetCardProps {
  thread: FleetThread;
  parent: FleetThread | undefined;
  redact: FleetRedactor;
  now: number;
  pending: ReadonlySet<string>;
  lifted?: boolean;
  contextOnly?: boolean;
  selected: boolean;
  family?: FleetFamily;
  familyOpen?: boolean;
  onToggleFamily?: () => void;
  onSelect: (thread: FleetThread) => void;
  onOpen: (thread: FleetThread, split: boolean) => void;
}

export function FleetCard({
  thread,
  parent,
  redact,
  now,
  pending,
  lifted,
  contextOnly,
  selected,
  family,
  familyOpen,
  onToggleFamily,
  onSelect,
  onOpen,
}: FleetCardProps) {
  const providers = useContext(FleetProvidersContext);
  const kind = KIND_LABELS[thread.kind];
  const configured = configuredLine(
    thread,
    pending.has("configuredExecution"),
    pending.has("loading"),
  );
  const reason = reasonText(thread, redact, pending.has("inputRequest"));
  const counts = family ? familyCounts(family) : null;
  const age = Math.max(0, now - thread.entry.updatedAt);
  return (
    <div
      role="group"
      data-fleet-card={thread.id}
      data-attention={thread.attention ?? undefined}
      className={cn(
        "relative flex min-h-[236px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface-raised px-3 pt-2.5 pb-2 text-left md:h-[236px] [&>*]:shrink-0",
        contextOnly && "border-dotted bg-transparent",
        selected &&
          "border-foreground bg-accent shadow-[inset_0_3px_0_var(--color-foreground)]",
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-1 font-mono text-xs text-muted-foreground"
      >
        ┌
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-1 bottom-0 font-mono text-xs text-muted-foreground"
      >
        ┘
      </span>
      <button
        type="button"
        data-fleet-primary
        aria-label={`Open details: ${cardAccessibleName(thread, redact, parent, now, pending, providers)}`}
        aria-current={selected ? "true" : undefined}
        onClick={(event) =>
          event.metaKey || event.ctrlKey
            ? onOpen(thread, true)
            : onSelect(thread)
        }
        className="absolute inset-0 z-[1] rounded-md focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-foreground"
      />
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <FleetStateLabel thread={thread} className="whitespace-normal" />
        <span className="font-mono text-xs text-muted-foreground">
          {thread.entry.pinnedAt !== null ? (
            <span aria-label="Pinned">★ </span>
          ) : null}
          {formatShortAge(age)}
        </span>
      </div>
      {contextOnly ? (
        <div className="font-mono text-xs text-muted-foreground">
          family context · not in this filter
        </div>
      ) : null}
      {kind ? (
        lifted ? (
          <div className="mt-1 text-xs leading-tight text-muted-foreground">
            ↳ {kind} of
            <b className="block truncate font-medium text-foreground">
              {thread.parentStatus === "known" && parent
                ? middleTruncate(redact.title(parent), 30)
                : "parent unknown"}
            </b>
          </div>
        ) : (
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
            └ <b className="font-semibold text-foreground">{kind}</b>
            {thread.parentStatus === "unknown" ||
            thread.parentStatus === "archived" ? (
              <span className="block font-sans">
                {thread.parentStatus === "archived"
                  ? "parent archived"
                  : "parent unknown"}
              </span>
            ) : null}
          </div>
        )
      ) : null}
      <div
        className={cn(
          "mt-1 text-sm font-medium leading-snug text-foreground",
          redact.on ? "italic text-muted-foreground" : "",
          lifted || family ? "line-clamp-2" : "line-clamp-3",
        )}
      >
        {redact.on ? "▒ Hidden" : thread.title}
      </div>
      {reason ? (
        <div
          className={cn(
            "mt-1 text-[13px] leading-snug text-foreground/90",
            family ? "line-clamp-1" : "line-clamp-2",
          )}
        >
          {reason}
        </div>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-1">
        {thread.entry.queuedWork === "waiting" ? <Tag>Queued</Tag> : null}
        {thread.entry.queuedWork === "failed" ? (
          <Tag tone="error">▲ Queued message failed</Tag>
        ) : null}
        {thread.inTurnSubagents > 0 ? (
          <Tag>⋯ {thread.inTurnSubagents} in-turn subagents</Tag>
        ) : null}
        {thread.archived ? <Tag>Archived</Tag> : null}
      </div>
      <div className="flex-1" />
      {counts && counts.total > 0 && onToggleFamily ? (
        <button
          type="button"
          aria-expanded={familyOpen}
          aria-label={`${familyOpen ? "Collapse" : "Expand"} family of ${redact.title(thread)}: ${counts.total} ${counts.total === 1 ? "child" : "children"}${counts.attention > 0 ? `, ${counts.attention} need attention` : ""}`}
          onClick={onToggleFamily}
          className="relative z-[2] mb-1 min-h-11 rounded border border-border px-1.5 py-0.5 text-left text-xs text-foreground hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-foreground md:min-h-0"
        >
          {familyOpen ? "▾" : "▸"} {counts.total}{" "}
          {counts.total === 1 ? "child" : "children"}
          {counts.attention > 0
            ? ` · ${counts.attention} attention`
            : counts.working > 0
              ? ` · ${counts.working} working`
              : ""}
        </button>
      ) : null}
      <div
        aria-hidden="true"
        className="flex items-center gap-1 font-mono text-xs text-muted-foreground"
      >
        configured
        <span className="flex-1 border-t border-dotted border-border" />
      </div>
      <div className="font-mono text-xs break-all text-muted-foreground md:truncate md:break-normal">
        <span aria-hidden="true">
          {providers.get(thread.entry.providerId)?.glyph ?? "·"}{" "}
        </span>
        <b className="font-medium text-foreground">{configured.model}</b>
      </div>
      <div className="truncate font-mono text-xs text-muted-foreground">
        effort{" "}
        <b className="font-medium text-foreground">{configured.effort}</b>
      </div>
      <div className="text-xs text-muted-foreground md:truncate">
        {locationLine(thread, redact, now, pending.has("cloudSandboxState"))}
      </div>
    </div>
  );
}

export function FleetGhostCard({
  threads,
  redact,
  onGo,
}: {
  threads: FleetThread[];
  redact: FleetRedactor;
  onGo: (thread: FleetThread) => void;
}) {
  return (
    <div
      role="group"
      aria-label={`${threads.length} shown in Needs attention`}
      className="flex min-h-[236px] min-w-0 flex-col rounded-md border border-border-seam px-3 pt-2.5 pb-2 md:h-[236px]"
    >
      <span className="font-mono text-xs text-muted-foreground">
        ↑ SHOWN ABOVE · {threads.length}
      </span>
      {threads.map((thread) => (
        <div key={thread.id} className="mt-1.5 min-w-0">
          <div className="line-clamp-2 text-sm text-muted-foreground">
            {redact.on ? "▒ Hidden" : thread.title}
          </div>
          <button
            type="button"
            onClick={() => onGo(thread)}
            aria-label={`Go to ${redact.title(thread)} in Needs attention`}
            className="mt-0.5 min-h-11 max-w-full truncate rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-foreground md:min-h-0"
          >
            {KIND_LABELS[thread.kind] ?? "thread"} · {stateWord(thread).word} ·
            Go ↑
          </button>
        </div>
      ))}
    </div>
  );
}

function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <span
      className={cn(
        "pointer-events-none relative z-[2] rounded-sm border border-border px-1 font-mono text-xs leading-5 whitespace-nowrap",
        tone === "error" ? "text-destructive-text" : "text-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function middleTruncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) * 0.55);
  const tail = max - 1 - head;
  return `${value.slice(0, head).trimEnd()}…${value.slice(value.length - tail).trimStart()}`;
}

function formatShortAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}
