import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  definePluginApp,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useSidebarThreads,
  type ExperimentalSidebarFooterDisclosureProps,
  useBbContext,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@cloudroom/shared-ui/icon";
import { Button } from "@cloudroom/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cloudroom/shared-ui/dropdown-menu";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import {
  formatUsageReset,
  formatUsdCents,
  usageBarColorClass,
} from "@cloudroom/shared-ui/lib/usage-format";
import { LIST_HOVER_TRANSITION } from "@cloudroom/shared-ui/motion";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
} from "@cloudroom/shared-ui/option-display";
import {
  selectUsageMachine,
  usageRpcSuccessSchema,
  type UsageMachine,
  type UsageProvider,
  type UsageSnapshot,
  type UsageWindow as UsageWindowValue,
} from "./usage-schema.js";
import {
  allowanceText,
  formatObservedAge,
  formatPercent,
  formatObservedTime,
  freshnessText,
  paceText,
  usageAllowance,
  usageAllowanceMessages,
  usagePace,
  usagePaceMessages,
} from "./usage-details.js";
import {
  emptyUsageMessage,
  hasReportedUsage,
  offlineUsageMessage,
  UsageFeedback,
  usageFeedbackMessages,
} from "./usage-feedback.js";

import { requestUsageDetailsMachine, UsageSettings } from "./settings.js";

export interface UsageStoreSnapshot {
  data: UsageSnapshot | null;
  error: string | null;
  isRefreshing: boolean;
}

const CARD_MAX_AGE_MS = 2 * 60_000;
const FOCUS_MAX_AGE_MS = 5 * 60_000;
const SAFETY_REFRESH_INTERVAL_MS = 30 * 60_000;
const storeListeners = new Set<() => void>();
let storeSnapshot: UsageStoreSnapshot = {
  data: null,
  error: null,
  isRefreshing: false,
};
let activeRefreshCount = 0;
let lastMachineId: string | null = null;

function updateStore(next: UsageStoreSnapshot): void {
  storeSnapshot = next;
  for (const listener of storeListeners) listener();
}

function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

function getStoreSnapshot(): UsageStoreSnapshot {
  return storeSnapshot;
}

function rpcErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = Reflect.get(body, "error");
  if (typeof error === "string") return error;
  if (typeof error !== "object" || error === null) return null;
  const message = Reflect.get(error, "message");
  return typeof message === "string" ? message : null;
}

function refreshUsage({
  force,
  machineIds,
  maxAgeMs,
  providerId = null,
  signal,
}: {
  force: boolean;
  machineIds: string[] | null;
  maxAgeMs: number;
  providerId?: string | null;
  signal?: AbortSignal;
}): Promise<void> {
  activeRefreshCount += 1;
  updateStore({ ...storeSnapshot, error: null, isRefreshing: true });
  return (async () => {
    try {
      const response = await fetch(
        "/api/v1/plugins/provider-usage/rpc/getUsage",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force, machineIds, maxAgeMs, providerId }),
          signal:
            signal === undefined
              ? AbortSignal.timeout(60_000)
              : AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
        },
      );
      if (!response.ok)
        throw new Error(`Usage request returned HTTP ${response.status}.`);
      const body: unknown = await response.json();
      const parsed = usageRpcSuccessSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error(
          rpcErrorMessage(body) ?? "Provider usage could not be loaded.",
        );
      }
      updateStore({
        data: parsed.data.result,
        error: null,
        isRefreshing: activeRefreshCount > 1,
      });
    } catch (cause) {
      if (signal?.aborted === true) {
        return;
      }
      console.warn("Provider usage refresh failed", cause);
      updateStore({
        ...storeSnapshot,
        error: "Couldn’t refresh usage.",
      });
    } finally {
      activeRefreshCount -= 1;
      if (activeRefreshCount === 0 && storeSnapshot.isRefreshing) {
        updateStore({ ...storeSnapshot, isRefreshing: false });
      }
    }
  })();
}

function formatResetCountdown(resetsAt: string | null): string | null {
  if (resetsAt === null) return null;
  const remaining = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return "now";
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
}
const USAGE_BLOCKS = 12;

function usageTextColorClass(usedPercent: number): string {
  if (usedPercent >= 95) return "text-destructive-text";
  if (usedPercent >= 80) return "text-warning-text";
  return "text-sidebar-foreground";
}

function UsageBlocks({ usedPercent }: { usedPercent: number }) {
  const lit =
    usedPercent > 0
      ? Math.max(
          1,
          Math.round((Math.min(100, usedPercent) / 100) * USAGE_BLOCKS),
        )
      : 0;
  return (
    <span aria-hidden="true" className="flex shrink-0 gap-[1.5px]">
      {Array.from({ length: USAGE_BLOCKS }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-[9px] w-[5px] rounded-[1px]",
            index < lit ? usageBarColorClass(usedPercent) : "bg-sidebar-border",
          )}
        />
      ))}
    </span>
  );
}

function UsageWindow({
  window,
  last,
  account,
}: {
  window: UsageWindowValue;
  last: boolean;
  account: UsageProvider;
}) {
  const [showReset, setShowReset] = useState(false);
  const now = Date.now();
  const allowance = usageAllowance(window, account.observedAt, now);
  const pace = usagePace(window, account.observedAt, now);
  const paceSummary =
    pace.kind === "estimate"
      ? `${paceText(pace)} as of ${formatObservedTime(pace.observedAt)}, ${usagePaceMessages.basis.toLowerCase()}.`
      : `Pace unavailable: ${pace.reason.toLowerCase()}.`;
  const reset = formatUsageReset(window.resetsAt);
  const resetText = reset ?? usageAllowanceMessages.resetUnknown;
  const countdown =
    allowance.kind === "reset-since-update"
      ? null
      : formatResetCountdown(window.resetsAt);
  const cost =
    window.cost === null
      ? null
      : formatUsdCents(window.cost.usedUsdCents, true) +
        " / " +
        formatUsdCents(window.cost.limitUsdCents, false);
  const label = window.label
    .replace(/^Five-hour limit$|^5 hours$/u, "5h")
    .replace(/^Weekly limit$|^Weekly/u, "7d")
    .replace(/^Daily limit$/u, "1d")
    .replace(/^Plan usage$/u, "plan")
    .replace(/^On-demand spend$/u, "spend");
  const description = `${window.label}: ${allowanceText(allowance)}${cost === null ? "" : `, ${cost}`}.${allowance.kind === "reset-since-update" ? "" : ` ${reset ?? "Reset time not reported"}.`}${allowance.kind === "reported" ? ` ${paceSummary}` : ""} ${freshnessText(account, now)}.`;
  return (
    <button
      type="button"
      className="block w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      title={description}
      aria-label={description}
      aria-expanded={showReset}
      onClick={() => setShowReset((shown) => !shown)}
    >
      <span className="flex items-center gap-[7px] whitespace-nowrap">
        <span aria-hidden="true" className="text-subtle-foreground">
          {last ? "└" : "├"}
        </span>
        <span className="w-11 shrink-0 truncate lowercase text-muted-foreground">
          {label}
        </span>
        {allowance.kind === "reported" ? (
          <>
            <UsageBlocks usedPercent={allowance.usedPercent} />
            <span
              className={cn(
                "shrink-0 text-right tabular-nums",
                usageTextColorClass(allowance.usedPercent),
              )}
            >
              {formatPercent(allowance.remainingPercent)} left
            </span>
          </>
        ) : (
          <span className="min-w-0 truncate text-muted-foreground">
            {allowance.kind === "not-reported"
              ? "usage not reported"
              : "reset since last update"}
          </span>
        )}
        <span
          aria-hidden="true"
          className="ml-auto min-w-0 truncate tabular-nums text-subtle-foreground"
        >
          {countdown ?? (allowance.kind === "reset-since-update" ? "" : "—")}
        </span>
      </span>
      {allowance.kind === "reported" &&
      pace.kind === "estimate" &&
      pace.status !== "on-pace" ? (
        <span
          className={cn(
            "block pl-3.5",
            pace.status === "deficit"
              ? "text-warning-text"
              : "text-subtle-foreground",
          )}
        >
          {pace.status} {Math.round(pace.points * 10) / 10} pts · as of{" "}
          {formatObservedTime(pace.observedAt)}
        </span>
      ) : null}
      {allowance.kind === "reported" && allowance.overLimit ? (
        <span className="block pl-3.5 text-destructive-text">
          Over limit · {formatPercent(allowance.usedPercent)} used
        </span>
      ) : null}
      {showReset ? (
        <span className="block whitespace-normal pl-3.5 text-subtle-foreground">
          <span>
            {allowance.kind === "reset-since-update"
              ? `${usageAllowanceMessages.resetSinceUpdate}.`
              : resetText}
          </span>
          {allowance.kind === "reported"
            ? ` · ${formatPercent(allowance.usedPercent)} used`
            : null}
          {cost === null ? null : ` · ${cost}`}
          {allowance.kind === "reported" ? (
            <span className="block">{paceSummary}</span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

function shownAccounts(accounts: UsageProvider[]): UsageProvider[] {
  return accounts.some((account) => account.accountId)
    ? [accounts.find((account) => account.inUse) ?? accounts[0]!]
    : accounts;
}

function AccountFreshness({ account }: { account: UsageProvider }) {
  if (account.usage?.status !== "ok") return null;
  return (
    <span
      className={cn(
        "ml-auto shrink-0 font-normal text-subtle-foreground",
        account.refreshFailed && "text-warning-text",
      )}
    >
      {account.observedAt === null
        ? usageAllowanceMessages.updateUnavailable
        : `updated ${formatObservedAge(account.observedAt, Date.now())}`}
    </span>
  );
}

function RefreshFailedNote({ account }: { account: UsageProvider }) {
  if (!account.refreshFailed) return null;
  return (
    <p className="flex items-center gap-1 text-warning-text">
      <Icon name="AlertTriangle" aria-hidden="true" className="size-3 shrink-0" />
      Couldn’t refresh · showing last update
    </p>
  );
}

/** A tree-style status line under a provider, like `└ not installed`. */
function UsageNote({ children }: { children: string }) {
  return (
    <p className="flex gap-[7px] text-muted-foreground">
      <span aria-hidden="true" className="text-subtle-foreground">
        └
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

async function signInMacCodex(): Promise<void> {
  const call = async (method: "GET" | "POST") => {
    const response = await fetch("/api/v1/cloudroom/mac/codex-login", method === "POST" ? { method, headers: { "content-type": "application/json" }, body: "{}" } : {});
    if (!response.ok) throw new Error("Codex sign-in could not start.");
    return (await response.json()) as { state: string; message?: string };
  };
  let status = await call("POST");
  while (status.state === "waiting") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    status = await call("GET");
  }
  if (status.state === "error") throw new Error(status.message ?? "Codex sign-in failed.");
}

function CodexSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [state, setState] = useState<"idle" | "waiting" | "error">("idle");
  const [error, setError] = useState("");
  const signIn = () => {
    setState("waiting");
    signInMacCodex().then(
      () => { setState("idle"); onSignedIn(); },
      (cause: unknown) => { setState("error"); setError(cause instanceof Error ? cause.message : String(cause)); },
    );
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <UsageNote>{state === "waiting" ? "finish in your browser" : "session expired"}</UsageNote>
        <Button type="button" size="sm" className="h-6 px-2.5 text-xs" disabled={state === "waiting"} onClick={signIn}>
          {state === "waiting" ? "Waiting…" : "Sign in"}
        </Button>
      </div>
      {state === "error" ? <p role="alert" className="text-destructive">{error}</p> : null}
    </div>
  );
}

function ProviderUsageBody({ provider, onCodexSignedIn }: { provider: UsageProvider; onCodexSignedIn?: () => void }) {
  const usage = provider.usage;
  if (usage === null) return <UsageNote>Usage not reported.</UsageNote>;
  switch (usage.status) {
    case "ok":
      return usage.windows.length === 0 ? (
        <UsageNote>No usage limits reported for this plan.</UsageNote>
      ) : (
        <div>
          {usage.windows.map((window, index) => (
            <UsageWindow
              key={window.label}
              window={window}
              last={index === usage.windows.length - 1}
              account={provider}
            />
          ))}
        </div>
      );
    case "not_installed":
      return <UsageNote>Not installed on this machine.</UsageNote>;
    case "unauthenticated":
      return <UsageNote>{provider.signInHint}</UsageNote>;
    case "expired":
      return provider.providerId === "codex" && onCodexSignedIn ? (
        <CodexSignIn onSignedIn={onCodexSignedIn} />
      ) : (
        <UsageNote>{provider.expiredHint}</UsageNote>
      );
    case "error":
      return <UsageNote>{usage.message}</UsageNote>;
  }
}

function accountName(account: UsageProvider): string | null {
  return (
    account.accountLabel ??
    (account.usage?.status === "ok" ? account.usage.accountEmail : null)
  );
}

/** The account threads use, next to the provider name. With several accounts, it switches between them. */
function AccountChip({
  accounts,
  refresh,
}: {
  accounts: UsageProvider[];
  refresh: () => void;
}) {
  const shown =
    accounts.find((account) => account.inUse) ??
    (accounts.length === 1 ? accounts[0] : undefined);
  const label = shown ? accountName(shown) : null;
  const switchable = accounts.filter((account) => account.accountId);
  const chip = "block min-w-0 truncate font-normal text-subtle-foreground";
  if (label === null) return null;
  if (switchable.length < 2)
    return (
      <span title={label} className={chip}>
        {label}
      </span>
    );
  const use = async (account: UsageProvider) => {
    await fetch("/api/v1/plugins/accounts/rpc/accounts.use", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: account.providerId,
        id: account.accountId,
      }),
    }).catch(() => undefined);
    refresh();
  };
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={`Account in use: ${label}`}
          className={cn(chip, "text-left hover:text-sidebar-foreground")}
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-72">
        {switchable.map((account) => (
          <DropdownMenuItem
            key={account.id}
            role="menuitemradio"
            aria-checked={account.inUse === true}
            onSelect={() => void use(account)}
            className="flex items-center gap-2"
          >
            <span className="min-w-0 flex-1 truncate">
              {accountName(account) ?? "This Mac"}
            </span>
            <Icon
              name="Check"
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0",
                account.inUse ? "opacity-100" : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MachineSelector({
  machines,
  activeMachine,
  onSelect,
}: {
  machines: UsageMachine[];
  activeMachine: UsageMachine | null;
  onSelect: (machineId: string) => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={machines.length === 0}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={
            activeMachine === null
              ? "Usage machine"
              : "Usage machine: " + activeMachine.displayName
          }
          disabled={machines.length === 0}
          className={cn(
            OPTION_BASE_CLASS_NAME,
            OPTION_INTERACTIVE_CLASS_NAME,
            LIST_HOVER_TRANSITION,
            "h-6 shrink overflow-hidden px-1 font-mono text-[10.5px] font-normal text-subtle-foreground hover:bg-sidebar-accent",
          )}
        >
          <span className="block min-w-0 flex-1 truncate">
            ~/{activeMachine?.displayName ?? "usage"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        mobileTitle="Usage source"
        className="max-w-72"
      >
        {machines.map((machine) => {
          const isActive = machine.id === activeMachine?.id;
          return (
            <DropdownMenuItem
              key={machine.id}
              role="menuitemradio"
              aria-label={machine.displayName}
              aria-checked={isActive}
              onSelect={() => onSelect(machine.id)}
              className="flex items-center gap-2"
            >
              <Icon
                name={machine.id.startsWith("source:") ? "Layers" : "Laptop"}
                className="size-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate">
                {machine.displayName}
              </span>
              <Icon
                name="Check"
                aria-hidden="true"
                className={cn(
                  "size-3.5 shrink-0",
                  isActive ? "opacity-100" : "opacity-0",
                )}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Today's active minutes, shown only while the Time in Cloudroom plugin is enabled. */
function TimeInCloudroom() {
  const [minutes, setMinutes] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    let timer: number | null = null;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      const time = (await (await fetch("/api/v1/cloudroom/time-in-app?only=today")).json()) as { today?: unknown };
      if (live) setMinutes(typeof time.today === "number" ? time.today : null);
    };
    // The plugin list is checked once, when the panel opens; then only today's number, once a minute.
    void (async () => {
      const list = (await (await fetch("/api/v1/plugins")).json()) as { plugins?: { id: string; enabled: boolean }[] };
      if (!live || !list.plugins?.some((plugin) => plugin.id === "time-in-cloudroom" && plugin.enabled)) return;
      await load();
      if (live) timer = window.setInterval(() => void load().catch(() => {}), 60_000);
    })().catch(() => {});
    return () => {
      live = false;
      if (timer !== null) window.clearInterval(timer);
    };
  }, []);
  if (minutes === null) return null;
  return (
    <section
      aria-label="Time in Cloudroom"
      title="Time in Cloudroom today"
      className="flex shrink-0 items-center gap-1 tabular-nums"
    >
      <Icon name="Clock" aria-hidden="true" className="size-3 shrink-0" />
      {minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`}
    </section>
  );
}

export function ProviderUsageStatusContent({
  dismiss,
  snapshot,
  threadMachineId,
  refreshEnabled = true,
  onViewDetails,
}: ExperimentalSidebarFooterDisclosureProps & {
  snapshot: UsageStoreSnapshot;
  threadMachineId: string | null;
  refreshEnabled?: boolean;
  onViewDetails?: (machineId: string | null) => void;
}) {
  const [, refreshCountdowns] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(
      () => refreshCountdowns((tick) => tick + 1),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const machines = snapshot.data?.machines ?? [];
  const [requestedMachineId, setRequestedMachineId] = useState<string | null>(
    lastMachineId,
  );
  const activeMachine = selectUsageMachine(
    machines,
    requestedMachineId,
    threadMachineId,
  );
  const providers = useMemo(() => {
    const groups = new Map<
      string,
      UsageProvider & { accounts: UsageProvider[] }
    >();
    for (const account of activeMachine?.providers ?? []) {
      if (account.usage?.status === "not_installed") continue;
      const group = groups.get(account.providerId);
      if (group) group.accounts.push(account);
      else
        groups.set(account.providerId, {
          ...account,
          id: account.providerId,
          accounts: [account],
        });
    }
    return [...groups.values()];
  }, [activeMachine]);
  const hasUsage = hasReportedUsage(
    providers.flatMap((provider) => provider.accounts),
  );
  const feedback =
    activeMachine === null
      ? snapshot.error !== null
        ? usageFeedbackMessages.loadFailed
        : snapshot.isRefreshing
          ? usageFeedbackMessages.loading
          : usageFeedbackMessages.noSources
      : activeMachine.status === "disconnected"
        ? offlineUsageMessage(activeMachine, hasUsage)
        : snapshot.error !== null || activeMachine.error !== null
          ? hasUsage
            ? usageFeedbackMessages.refreshFailed
            : usageFeedbackMessages.loadFailed
          : providers.length === 0
            ? emptyUsageMessage(activeMachine)
            : null;
  const activeMachineId = activeMachine?.id ?? null;
  const hasProviders = providers.length > 0;

  useEffect(() => {
    if (!refreshEnabled || activeMachineId === null || !hasProviders) return;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void refreshUsage({
        force: false,
        machineIds: [activeMachineId],
        maxAgeMs: CARD_MAX_AGE_MS,
      });
    };
    refresh();
    const timer = window.setInterval(refresh, CARD_MAX_AGE_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [activeMachineId, hasProviders, refreshEnabled]);

  const selectMachine = useCallback((machineId: string) => {
    lastMachineId = machineId;
    setRequestedMachineId(machineId);
  }, []);

  return (
    <div className="flex max-h-80 flex-col">
      <div
        data-provider-usage-header=""
        className="mx-1.5 flex h-9 min-w-0 shrink-0 items-center gap-1 border-b border-sidebar-border pr-1 font-mono text-[10.5px] text-subtle-foreground"
      >
        <div className="flex min-w-0 flex-1">
          <MachineSelector
            machines={machines}
            activeMachine={activeMachine}
            onSelect={selectMachine}
          />
        </div>
        <TimeInCloudroom />
        <button
          type="button"
          aria-label="Reload provider usage"
          disabled={snapshot.isRefreshing}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-50"
          onClick={() =>
            void refreshUsage({
              force: true,
              machineIds: activeMachineId === null ? null : [activeMachineId],
              maxAgeMs: 0,
            })
          }
        >
          <Icon
            name="RotateCcw"
            aria-hidden="true"
            className={
              "size-3 " + (snapshot.isRefreshing ? "animate-spin" : "")
            }
          />
        </button>
        <button
          type="button"
          aria-label="Collapse provider usage"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          onClick={dismiss}
        >
          <Icon name="ChevronDown" aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 space-y-1.5 overflow-y-auto px-[11px] pb-2.5 pt-1.5 font-mono text-[10.5px] leading-[1.75]">
        {feedback === null ? null : (
          <UsageFeedback
            message={feedback}
            loading={feedback === usageFeedbackMessages.loading}
          />
        )}
        {providers.map((provider) => (
          <section key={provider.id} aria-label={provider.displayName}>
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="flex min-w-0 flex-1 items-center gap-2 font-normal">
                <ProviderIcon
                  providerKind="agent"
                  provider={provider}
                  fallback="Bot"
                  className="size-3 shrink-0"
                />
                <span className="shrink-0 lowercase text-primary-text">
                  {provider.displayName}
                </span>
                <AccountChip
                  accounts={provider.accounts}
                  refresh={() =>
                    void refreshUsage({
                      force: false,
                      machineIds:
                        activeMachineId === null ? null : [activeMachineId],
                      maxAgeMs: CARD_MAX_AGE_MS,
                    })
                  }
                />
              </h2>
              {shownAccounts(provider.accounts).length === 1 ? (
                <AccountFreshness
                  account={shownAccounts(provider.accounts)[0]!}
                />
              ) : null}
            </div>
            {shownAccounts(provider.accounts).map((account, _, shown) => (
              <div key={account.id}>
                {shown.length === 1 ? null : (
                  <div className="flex min-w-0 items-center gap-2">
                    {account.accountLabel === null ? null : (
                      <h3
                        title={account.accountLabel}
                        className="min-w-0 truncate text-subtle-foreground"
                      >
                        {account.accountLabel}
                      </h3>
                    )}
                    <AccountFreshness account={account} />
                  </div>
                )}
                <RefreshFailedNote account={account} />
                {account.usage === null && snapshot.isRefreshing ? (
                  <UsageNote>{usageFeedbackMessages.loading}</UsageNote>
                ) : account.usage === null &&
                  (activeMachine?.error != null || snapshot.error !== null) ? (
                  <UsageNote>{usageFeedbackMessages.unavailable}</UsageNote>
                ) : (
                  <ProviderUsageBody
                    provider={account}
                    onCodexSignedIn={
                      activeMachine?.id.startsWith("source:") ||
                      (account.accountId && account.accountId !== "local")
                        ? undefined
                        : () =>
                            void refreshUsage({
                              force: true,
                              machineIds:
                                activeMachineId === null
                                  ? null
                                  : [activeMachineId],
                              maxAgeMs: 0,
                            })
                    }
                  />
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
      {onViewDetails === undefined ? null : (
        <button
          type="button"
          className="mx-1.5 flex min-h-8 shrink-0 items-center justify-between gap-2 border-t border-sidebar-border px-1.5 text-left font-mono text-[10.5px] text-muted-foreground hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:min-h-11"
          onClick={() => onViewDetails(activeMachineId)}
        >
          View usage details
          <Icon name="ChevronRight" aria-hidden="true" className="size-3" />
        </button>
      )}
    </div>
  );
}

function ProviderUsageStatus(props: ExperimentalSidebarFooterDisclosureProps) {
  const snapshot = useSyncExternalStore(
    subscribeStore,
    getStoreSnapshot,
    getStoreSnapshot,
  );
  const { threadId } = useBbContext();
  const sidebarThreads = experimental_useSidebarThreads();
  const threadMachineId = useMemo(
    () =>
      sidebarThreads.threads.find((thread) => thread.id === threadId)?.host
        ?.id ?? null,
    [sidebarThreads.threads, threadId],
  );
  return (
    <ProviderUsageStatusContent
      {...props}
      snapshot={snapshot}
      threadMachineId={threadMachineId}
      onViewDetails={(machineId) => {
        requestUsageDetailsMachine(machineId);
        props.openPluginDetails();
      }}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({ id: "usage", component: UsageSettings });
  app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "usage",
    label: "Provider usage",
    icon: "ChartColumn",
    component: ProviderUsageStatus,
  });
  app.contentScripts.register({
    id: "refresh-usage",
    mount({ signal }) {
      let timer: number | null = null;
      let hiddenAt = document.visibilityState === "hidden" ? Date.now() : null;
      let blurredAt: number | null = null;
      const scheduleSafetyRefresh = () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        if (signal.aborted || document.visibilityState !== "visible") return;
        timer = window.setTimeout(runSafetyRefresh, SAFETY_REFRESH_INTERVAL_MS);
      };
      const reconcile = (maxAgeMs: number, machineIds: string[] | null) => {
        void refreshUsage({
          force: false,
          machineIds,
          maxAgeMs,
          signal,
        });
      };
      const runSafetyRefresh = () => {
        if (document.visibilityState === "visible") {
          reconcile(SAFETY_REFRESH_INTERVAL_MS, null);
        }
        scheduleSafetyRefresh();
      };
      const onActive = () => {
        const inactiveAt =
          hiddenAt === null
            ? blurredAt
            : blurredAt === null
              ? hiddenAt
              : Math.min(hiddenAt, blurredAt);
        hiddenAt = null;
        blurredAt = null;
        if (
          inactiveAt !== null &&
          Date.now() - inactiveAt >= FOCUS_MAX_AGE_MS
        ) {
          reconcile(FOCUS_MAX_AGE_MS, null);
        }
        scheduleSafetyRefresh();
      };
      const onVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
          hiddenAt ??= Date.now();
          if (timer !== null) window.clearTimeout(timer);
          timer = null;
          return;
        }
        onActive();
      };
      const onBlur = () => {
        blurredAt ??= Date.now();
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("blur", onBlur);
      window.addEventListener("focus", onActive);
      reconcile(SAFETY_REFRESH_INTERVAL_MS, null);
      scheduleSafetyRefresh();
      return () => {
        if (timer !== null) window.clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("focus", onActive);
      };
    },
  });
});
