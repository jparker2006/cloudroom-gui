import { useId, type ReactNode } from "react";
import { experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import {
  formatUsageReset,
  formatUsdCents,
  usageBarColorClass,
} from "@cloudroom/shared-ui/lib/usage-format";
import {
  emptyUsageMessage,
  hasReportedUsage,
  offlineUsageMessage,
  UsageFeedback,
  usageFeedbackMessages,
} from "./usage-feedback.js";
import type {
  ProviderUsage,
  UsageMachine,
  UsageProvider,
  UsageWindow,
} from "./usage-schema.js";

export type UsageAllowance =
  | {
      kind: "reported";
      usedPercent: number;
      remainingPercent: number;
      overLimit: boolean;
    }
  | { kind: "not-reported" }
  | { kind: "reset-since-update" };

export const usageAllowanceMessages = {
  notReported: "Usage not reported",
  resetSinceUpdate: "Reset since last update",
  resetUnknown: "Reset time not reported.",
  updateUnavailable: "Last update unavailable",
} as const;

export function usageAllowance(
  window: Pick<UsageWindow, "usedPercent" | "resetsAt">,
  observedAt: number | null,
  now: number,
): UsageAllowance {
  const resetAt =
    window.resetsAt === null ? Number.NaN : Date.parse(window.resetsAt);
  if (
    Number.isFinite(resetAt) &&
    resetAt <= now &&
    (observedAt === null || resetAt > observedAt)
  )
    return { kind: "reset-since-update" };
  const used = window.usedPercent;
  if (used === null || !Number.isFinite(used) || used < 0)
    return { kind: "not-reported" };
  return {
    kind: "reported",
    usedPercent: used,
    remainingPercent: Math.max(0, 100 - used),
    overLimit: used > 100,
  };
}

const VERIFIED_WINDOW_MS: Partial<Record<UsageWindow["kind"], number>> = {
  "five-hour": 5 * 60 * 60_000,
  weekly: 7 * 24 * 60 * 60_000,
};
const ON_PACE_POINTS = 2;
const MIN_ELAPSED_FRACTION = 0.03;

export type UsagePace =
  | {
      kind: "estimate";
      status: "deficit" | "reserve" | "on-pace";
      points: number;
      observedAt: number;
    }
  | { kind: "unavailable"; reason: string };

export const usagePaceMessages = {
  basis: "Compared with even usage through this window",
  noObservation: "No successful measurement time",
  noDuration: "Window length not reported",
  noReset: "Reset time not reported",
  noUsage: "Usage not reported",
  expired: "Window had already reset when measured",
  resetSinceUpdate: "Reset since last update",
  mismatch: "Reset time doesn’t match the window length",
  early: "Too early in the window",
} as const;

export function usagePace(
  window: Pick<UsageWindow, "kind" | "usedPercent" | "resetsAt">,
  observedAt: number | null,
  now: number,
): UsagePace {
  const unavailable = (reason: string): UsagePace => ({
    kind: "unavailable",
    reason,
  });
  if (observedAt === null || !Number.isFinite(observedAt))
    return unavailable(usagePaceMessages.noObservation);
  const duration = VERIFIED_WINDOW_MS[window.kind];
  if (duration === undefined) return unavailable(usagePaceMessages.noDuration);
  const resetAt =
    window.resetsAt === null ? Number.NaN : Date.parse(window.resetsAt);
  if (!Number.isFinite(resetAt)) return unavailable(usagePaceMessages.noReset);
  if (resetAt <= observedAt) return unavailable(usagePaceMessages.expired);
  if (now >= resetAt) return unavailable(usagePaceMessages.resetSinceUpdate);
  const used = window.usedPercent;
  if (used === null || !Number.isFinite(used) || used < 0)
    return unavailable(usagePaceMessages.noUsage);
  const elapsed = (observedAt - (resetAt - duration)) / duration;
  if (elapsed < 0) return unavailable(usagePaceMessages.mismatch);
  if (elapsed < MIN_ELAPSED_FRACTION)
    return unavailable(usagePaceMessages.early);
  const difference = used - elapsed * 100;
  return {
    kind: "estimate",
    status:
      difference > ON_PACE_POINTS
        ? "deficit"
        : difference < -ON_PACE_POINTS
          ? "reserve"
          : "on-pace",
    points: Math.abs(difference),
    observedAt,
  };
}

export function paceText(
  pace: Extract<UsagePace, { kind: "estimate" }>,
): string {
  const points = Math.round(pace.points * 10) / 10;
  const unit = points === 1 ? "percentage point" : "percentage points";
  switch (pace.status) {
    case "deficit":
      return `Deficit by ${points} ${unit}`;
    case "reserve":
      return `Reserve by ${points} ${unit}`;
    case "on-pace":
      return "On pace";
  }
}

export function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`;
}

export function allowanceText(allowance: UsageAllowance): string {
  switch (allowance.kind) {
    case "reported":
      return `${allowance.overLimit ? "Over limit · " : ""}${formatPercent(allowance.remainingPercent)} left, ${formatPercent(allowance.usedPercent)} used`;
    case "not-reported":
      return usageAllowanceMessages.notReported;
    case "reset-since-update":
      return usageAllowanceMessages.resetSinceUpdate;
  }
}

export function formatObservedAge(observedAt: number, now: number): string {
  const minutes = Math.floor((now - observedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function formatObservedTime(observedAt: number): string {
  return new Date(observedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function freshnessText(
  provider: Pick<UsageProvider, "observedAt" | "refreshFailed">,
  now: number,
): string {
  const base =
    provider.observedAt === null
      ? usageAllowanceMessages.updateUnavailable
      : `Updated ${formatObservedAge(provider.observedAt, now)}`;
  return provider.refreshFailed ? `${base} · Couldn’t refresh` : base;
}

function SettingsBadge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground">
      {children}
    </span>
  );
}

function UsageFreshness({
  provider,
  now,
}: {
  provider: UsageProvider;
  now: number;
}) {
  return (
    <p
      className={cn(
        "text-xs text-subtle-foreground",
        provider.refreshFailed && "text-warning-text",
      )}
    >
      {provider.observedAt === null ? (
        usageAllowanceMessages.updateUnavailable
      ) : (
        <>
          Last updated {formatObservedAge(provider.observedAt, now)} ·{" "}
          <time dateTime={new Date(provider.observedAt).toISOString()}>
            {formatObservedTime(provider.observedAt)}
          </time>
        </>
      )}
      {provider.refreshFailed ? " · Couldn’t refresh" : null}
    </p>
  );
}

function UsagePaceLine({ pace }: { pace: UsagePace }) {
  if (pace.kind === "unavailable")
    return (
      <p className="text-xs text-subtle-foreground">
        Pace unavailable: {pace.reason.toLowerCase()}
      </p>
    );
  return (
    <p className="text-xs text-subtle-foreground">
      <span
        className={cn(
          "font-medium",
          pace.status === "deficit" ? "text-warning-text" : "text-foreground",
        )}
      >
        {paceText(pace)}
      </span>
      {` · As of ${formatObservedTime(pace.observedAt)}. `}
      {usagePaceMessages.basis}.
    </p>
  );
}

function UsageWindowRow({
  window,
  observedAt,
  now,
}: {
  window: UsageWindow;
  observedAt: number | null;
  now: number;
}) {
  const allowance = usageAllowance(window, observedAt, now);
  const reset = formatUsageReset(window.resetsAt);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-xs text-foreground">{window.label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {allowance.kind === "reported" ? (
            <>
              <span
                className={cn(
                  "font-medium",
                  allowance.overLimit
                    ? "text-destructive-text"
                    : "text-foreground",
                )}
              >
                {allowance.overLimit ? "Over limit · " : ""}
                {formatPercent(allowance.remainingPercent)} remaining
              </span>
              {" · "}
              {`${formatPercent(allowance.usedPercent)} used`}
              {window.cost === null
                ? null
                : ` · ${formatUsdCents(window.cost.usedUsdCents, true)} / ${formatUsdCents(window.cost.limitUsdCents, false)}`}
            </>
          ) : (
            allowanceText(allowance)
          )}
        </span>
      </div>
      {allowance.kind === "reported" ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              usageBarColorClass(allowance.usedPercent),
            )}
            style={{ width: `${Math.min(100, allowance.usedPercent)}%` }}
          />
        </div>
      ) : null}
      {allowance.kind === "reset-since-update" ? null : (
        <p className="text-xs text-muted-foreground">
          {reset ?? usageAllowanceMessages.resetUnknown}
        </p>
      )}
      {allowance.kind === "reported" ? (
        <UsagePaceLine pace={usagePace(window, observedAt, now)} />
      ) : null}
    </div>
  );
}

function ProviderUsageBody({
  provider,
  usage,
  isLoading,
  isError,
  now,
}: {
  provider: UsageProvider;
  usage: ProviderUsage | null;
  isLoading: boolean;
  isError: boolean;
  now: number;
}) {
  if (isError)
    return (
      <p className="text-xs text-muted-foreground">
        {usageFeedbackMessages.unavailable}
      </p>
    );
  if (!usage)
    return (
      <p className="text-xs text-muted-foreground">
        {isLoading ? "Loading usage…" : "Usage not provided."}
      </p>
    );
  switch (usage.status) {
    case "ok":
      return usage.windows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No usage limits reported for this plan.
        </p>
      ) : (
        <div className="space-y-3.5">
          {usage.windows.map((window) => (
            <UsageWindowRow
              key={window.label}
              window={window}
              observedAt={provider.observedAt}
              now={now}
            />
          ))}
        </div>
      );
    case "not_installed":
      return (
        <p className="text-xs text-muted-foreground">
          Not installed on this machine.
        </p>
      );
    case "unauthenticated":
      return (
        <p className="text-xs text-muted-foreground">{provider.signInHint}</p>
      );
    case "expired":
      return (
        <p className="text-xs text-muted-foreground">{provider.expiredHint}</p>
      );
    case "error":
      return <p className="text-xs text-muted-foreground">{usage.message}</p>;
  }
}

function UsageAccountDetails({
  provider,
  isLoading,
  isError,
  now,
}: {
  provider: UsageProvider;
  isLoading: boolean;
  isError: boolean;
  now: number;
}) {
  const usage = provider.usage;
  const planLabel = usage?.status === "ok" ? usage.planLabel : null;
  const accountLabel =
    (usage?.status === "ok" ? usage.accountEmail : null) ??
    provider.accountLabel;
  const headingId = useId();
  const showsWindows =
    !(isError && usage === null) &&
    usage?.status === "ok" &&
    usage.windows.length > 0;
  const body = (
    <ProviderUsageBody
      provider={provider}
      usage={usage}
      isLoading={isLoading}
      isError={isError && usage === null}
      now={now}
    />
  );
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3.5 py-3.5 first:pt-0 last:pb-0"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span aria-hidden="true" className="mt-0.5 shrink-0">
            <ProviderIcon
              providerKind="agent"
              provider={{ ...provider, id: provider.providerId }}
              className="size-4"
            />
          </span>
          <div className="min-w-0 flex-1">
            <h3
              id={headingId}
              className="text-sm font-semibold text-foreground"
            >
              {provider.displayName}
            </h3>
            {accountLabel && accountLabel !== provider.displayName ? (
              <p className="truncate text-xs text-muted-foreground">
                {accountLabel}
              </p>
            ) : null}
            {usage?.status === "ok" ? (
              <UsageFreshness provider={provider} now={now} />
            ) : null}
            {showsWindows ? null : (
              <div className={accountLabel ? "mt-1.5" : undefined}>{body}</div>
            )}
          </div>
        </div>
        {planLabel ? <SettingsBadge>{planLabel}</SettingsBadge> : null}
      </div>
      {showsWindows ? <div className="pl-6">{body}</div> : null}
    </section>
  );
}

export function usageDetailsNotice(
  machine: UsageMachine | null,
  loading: boolean,
  error: boolean,
): string | null {
  const providers = (machine?.providers ?? []).filter(
    (provider) => provider.usage?.status !== "not_installed",
  );
  if (machine === null)
    return error
      ? usageFeedbackMessages.loadFailed
      : loading
        ? usageFeedbackMessages.loading
        : usageFeedbackMessages.noSources;
  if (machine.status === "disconnected")
    return offlineUsageMessage(machine, hasReportedUsage(machine.providers));
  if (error || machine.error)
    return hasReportedUsage(machine.providers)
      ? usageFeedbackMessages.refreshFailed
      : usageFeedbackMessages.loadFailed;
  return providers.length === 0 ? emptyUsageMessage(machine) : null;
}

export function UsageDetails({
  machine,
  loading,
  error,
  now = Date.now(),
}: {
  machine: UsageMachine | null;
  loading: boolean;
  error: boolean;
  now?: number;
}) {
  const groups = new Map<string, UsageProvider[]>();
  for (const provider of machine?.providers ?? []) {
    if (provider.usage?.status === "not_installed") continue;
    const group = groups.get(provider.providerId);
    if (group) group.push(provider);
    else groups.set(provider.providerId, [provider]);
  }
  const notice = usageDetailsNotice(machine, loading, error);
  const isError = error || Boolean(machine?.error);
  return (
    <div
      aria-label={
        machine === null ? undefined : `Usage from ${machine.displayName}`
      }
      role={machine === null ? undefined : "group"}
    >
      {notice ? (
        <UsageFeedback
          message={notice}
          loading={notice === usageFeedbackMessages.loading}
          className={groups.size > 0 ? "mb-3" : undefined}
        />
      ) : null}
      <div className="divide-y divide-border">
        {[...groups].map(([id, accounts]) => (
          <div key={id} className="py-3.5 first:pt-0 last:pb-0">
            {accounts.map((provider) => (
              <UsageAccountDetails
                key={provider.id}
                provider={provider}
                isLoading={loading}
                isError={isError}
                now={now}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
