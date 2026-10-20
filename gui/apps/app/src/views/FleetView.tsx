import { useStore } from "jotai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import { useSidebar } from "@/components/ui/sidebar.js";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import { useServerConnectionState } from "@/hooks/useServerConnectionState";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  useFleetArchived,
  useFleetSupplement,
} from "@/hooks/queries/fleet-queries";
import { useHosts } from "@/hooks/queries/host-queries";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { getThreadRoutePath } from "@/lib/route-paths";
import { openThreadInSplit } from "@/lib/split-layout/openThreadInSplit";
import {
  FleetCard,
  FleetGhostCard,
  FleetProvidersContext,
  harnessName,
  type FleetProviders,
  middleTruncate,
} from "@/components/fleet/FleetCard";
import { FleetInspector } from "@/components/fleet/FleetInspector";
import {
  ATTENTION_LABELS,
  buildFleetModel,
  createRedactor,
  EMPTY_FLEET_FILTERS,
  familyCounts,
  formatAge,
  sortProjects,
  type FleetAttention,
  type FleetFamily,
  type FleetFilters,
  type FleetModel,
  type FleetRedactor,
  type FleetSort,
  type FleetStateFilter,
  type FleetThread,
} from "@/components/fleet/fleet-model";

const HIDE_TITLES_KEY = "bb.fleet.hideTitles";
const GRID =
  "grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))] md:gap-3 md:[grid-template-columns:repeat(auto-fill,minmax(184px,1fr))]";
const PENDING_WORDS: Record<string, string> = {
  configuredExecution: "configured model and effort",
  inputRequest: "request kind and text",
  activityLabel: "latest activity",
  fallbackModel: "served-model fallback",
  cloudSandboxState: "cloud sleep state",
  workflowLineage: "workflow worker parents",
};

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function AsciiRule({
  children,
  sub,
}: {
  children: React.ReactNode;
  sub?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 font-mono text-xs whitespace-nowrap",
        sub
          ? "mt-3 mb-2 text-muted-foreground"
          : "mt-4 mb-2 font-semibold tracking-wide text-foreground",
      )}
    >
      <span aria-hidden="true" className="text-border">
        ──
      </span>
      {children}
      <span aria-hidden="true" className="flex-1 border-t border-border" />
    </div>
  );
}

function flatten(
  family: FleetFamily,
  collapsed: ReadonlySet<string> = new Set(),
  depth = 0,
): { thread: FleetThread; depth: number; family: FleetFamily }[] {
  return family.children.flatMap((child) => [
    { thread: child.thread, depth: depth + 1, family: child },
    ...(collapsed.has(child.thread.id)
      ? []
      : flatten(child, collapsed, depth + 1)),
  ]);
}

export function FleetView() {
  const navigation = useSidebarNavigation();
  const supplement = useFleetSupplement(navigation.dataUpdatedAt);
  const hosts = useHosts();
  const systemProviders = useSystemProviders();
  const providers = useMemo<FleetProviders>(
    () =>
      new Map(
        (systemProviders.data ?? []).map((provider) => [
          provider.id,
          { name: provider.displayName, glyph: provider.icon?.glyph ?? null },
        ]),
      ),
    [systemProviders.data],
  );
  const sidebar = useSidebar();
  const navigate = useRouteNavigate();
  const store = useStore();
  const compact = sidebar.isCompactViewport;
  const now = useNow(10_000);
  const [filters, setFilters] = useState<FleetFilters>(EMPTY_FLEET_FILTERS);
  const archived = useFleetArchived(filters.state === "archived");
  const supplementData = useMemo(
    () =>
      supplement.data && archived.data
        ? {
            ...supplement.data,
            archivedThreads: archived.data.archivedThreads,
            archivedTruncated: archived.data.archivedTruncated,
          }
        : supplement.data,
    [supplement.data, archived.data],
  );
  const [sort, setSort] = useState<FleetSort>("attention");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [collapsedProjects, setCollapsedProjects] = useState<
    ReadonlySet<string>
  >(new Set());
  const [collapsedFamilies, setCollapsedFamilies] = useState<
    ReadonlySet<string>
  >(new Set());
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [hideTitles, setHideTitles] = useState(
    () => window.localStorage.getItem(HIDE_TITLES_KEY) === "1",
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.localStorage.setItem(HIDE_TITLES_KEY, hideTitles ? "1" : "0");
  }, [hideTitles]);

  const model = useMemo<FleetModel | null>(() => {
    if (!navigation.data) return null;
    return buildFleetModel({
      bootstrap: navigation.data,
      supplement: supplementData,
      hosts: hosts.data,
      filters,
      searchNames: !hideTitles,
      supplementLoading: supplement.isPending,
    });
  }, [
    navigation.data,
    supplementData,
    supplement.isPending,
    hosts.data,
    filters,
    hideTitles,
  ]);

  const redact = useMemo<FleetRedactor>(() => {
    const projects = navigation.data
      ? [
          ...navigation.data.projects.map((project) => project.id),
          navigation.data.personalProject.id,
          ...(supplementData?.extraProjects ?? []).map((project) => project.id),
        ]
      : [];
    return createRedactor(
      hideTitles,
      projects,
      (hosts.data ?? []).map((host) => host.id),
    );
  }, [hideTitles, navigation.data, hosts.data, supplementData]);

  const connection = useServerConnectionState();
  const familyById = useMemo(() => {
    const map = new Map<string, FleetFamily>();
    const walk = (family: FleetFamily) => {
      if (family.children.length > 0) map.set(family.thread.id, family);
      family.children.forEach(walk);
    };
    model?.projects.forEach((group) => group.families.forEach(walk));
    return map;
  }, [model]);

  const selected =
    selectedId && model ? (model.byId.get(selectedId) ?? null) : null;

  const open = useCallback(
    (thread: FleetThread, split: boolean) => {
      if (split) {
        openThreadInSplit({
          store,
          navigate,
          projectId: thread.projectId,
          threadId: thread.id,
          isCompact: compact,
        });
        return;
      }
      navigate(
        getThreadRoutePath({
          projectId: thread.projectId,
          threadId: thread.id,
        }),
      );
    },
    [compact, navigate, store],
  );

  const select = useCallback((thread: FleetThread) => {
    setSelectedId(thread.id);
    setInspectorOpen(true);
  }, []);

  const focusCard = useCallback((id: string) => {
    const button = bodyRef.current?.querySelector<HTMLButtonElement>(
      `[data-fleet-card="${id}"] [data-fleet-primary]`,
    );
    button?.focus();
    button?.scrollIntoView({ block: "nearest" });
  }, []);

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    if (selectedId) window.requestAnimationFrame(() => focusCard(selectedId));
  }, [focusCard, selectedId]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "SELECT") return;
      // The phone drawer is a modal portal; its own handler owns Escape and
      // grid shortcuts must not move focus behind it.
      if (target.closest('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === "Escape" && inspectorOpen && selected) {
        event.preventDefault();
        closeInspector();
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const buttons = Array.from(
        bodyRef.current?.querySelectorAll<HTMLButtonElement>(
          "[data-fleet-primary]",
        ) ?? [],
      );
      const index = buttons.indexOf(target as HTMLButtonElement);
      if (event.key === "n" || event.key === "N") {
        const attention = buttons.filter((button) =>
          button.closest("[data-attention]"),
        );
        const next =
          attention.find((button) => buttons.indexOf(button) > index) ??
          attention[0];
        if (next) {
          event.preventDefault();
          next.focus();
          next.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      if (index === -1) return;
      if (
        (event.key === "Enter" || event.key === " ") &&
        (event.metaKey || event.ctrlKey)
      ) {
        const id = target
          .closest("[data-fleet-card]")
          ?.getAttribute("data-fleet-card");
        const thread = id ? model?.byId.get(id) : undefined;
        if (thread) {
          event.preventDefault();
          open(thread, true);
        }
        return;
      }
      const move = (to: HTMLButtonElement | undefined) => {
        if (!to) return;
        event.preventDefault();
        to.focus();
        to.scrollIntoView({ block: "nearest" });
      };
      if (event.key === "ArrowRight") move(buttons[index + 1]);
      if (event.key === "ArrowLeft") move(buttons[index - 1]);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const rect = target.getBoundingClientRect();
        const down = event.key === "ArrowDown";
        const candidates = buttons
          .map((button) => ({ button, rect: button.getBoundingClientRect() }))
          .filter(({ rect: r }) =>
            down ? r.top > rect.top + 4 : r.top < rect.top - 4,
          );
        const rowTop = down
          ? Math.min(...candidates.map(({ rect: r }) => r.top))
          : Math.max(...candidates.map(({ rect: r }) => r.top));
        const row = candidates.filter(
          ({ rect: r }) => Math.abs(r.top - rowTop) < 4,
        );
        row.sort(
          (a, b) =>
            Math.abs(a.rect.left - rect.left) -
            Math.abs(b.rect.left - rect.left),
        );
        move(row[0]?.button);
      }
    },
    [closeInspector, inspectorOpen, model, open, selected],
  );

  if (navigation.isError) {
    return (
      <div className="p-6 text-sm text-destructive-text">
        Couldn't load threads for the fleet.
      </div>
    );
  }
  if (!model) {
    return (
      <div className="p-6 font-mono text-xs text-muted-foreground">
        Loading fleet…
      </div>
    );
  }

  const setState = (state: FleetStateFilter | null) =>
    setFilters((current) => ({
      ...current,
      state: current.state === state ? null : state,
    }));
  const setSingle = (
    key: "projectIds" | "locations" | "harnesses",
    value: string,
  ) =>
    setFilters((current) => ({
      ...current,
      [key]: value === "" ? new Set() : new Set([value]),
    }));
  const attentionGroups = (Object.keys(ATTENTION_LABELS) as FleetAttention[])
    .map(
      (reason) =>
        [
          reason,
          model.attention.filter((thread) => thread.attention === reason)
            .length,
        ] as const,
    )
    .filter(([, n]) => n > 0);
  const attentionLimit =
    compact && !showAllAttention ? 4 : model.attention.length;
  const parentOf = (thread: FleetThread) =>
    thread.parentId ? model.byId.get(thread.parentId) : undefined;
  const pending: ReadonlySet<string> =
    model.source === "loading"
      ? new Set(["loading"])
      : (model.pendingFields as ReadonlySet<string>);
  const hostList = hosts.data ?? [];
  const archivedLabel =
    model.source === "server" || model.source === "fixture"
      ? String(model.counts.archived)
      : "—";
  const inspector = selected && inspectorOpen ? selected : null;
  const supplementAge = supplement.dataUpdatedAt
    ? formatAge(now - supplement.dataUpdatedAt)
    : null;

  const card = (
    thread: FleetThread,
    options: { lifted?: boolean; family?: FleetFamily } = {},
  ) => (
    <FleetCard
      key={thread.id}
      thread={thread}
      parent={parentOf(thread)}
      redact={redact}
      now={now}
      pending={pending}
      lifted={options.lifted}
      contextOnly={!model.matchedIds.has(thread.id)}
      selected={selected?.id === thread.id}
      family={options.family}
      familyOpen={
        options.family ? !collapsedFamilies.has(thread.id) : undefined
      }
      onToggleFamily={
        options.family
          ? () =>
              setCollapsedFamilies((current) => {
                const next = new Set(current);
                if (next.has(thread.id)) next.delete(thread.id);
                else next.add(thread.id);
                return next;
              })
          : undefined
      }
      onSelect={select}
      onOpen={open}
    />
  );

  const ghost = (threads: FleetThread[], key: string) =>
    threads.length > 0 ? (
      <FleetGhostCard
        key={key}
        threads={threads}
        redact={redact}
        onGo={(thread) => {
          const rendered = bodyRef.current?.querySelector(
            `[data-fleet-card="${thread.id}"]`,
          );
          if (!rendered) setShowAllAttention(true);
          window.requestAnimationFrame(() => focusCard(thread.id));
        }}
      />
    ) : null;

  return (
    <FleetProvidersContext.Provider value={providers}>
      <div
        className="flex h-full min-h-0 w-full bg-background text-foreground"
        data-testid="fleet-view"
        onKeyDown={onKeyDown}
      >
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            compact && "overflow-y-auto",
          )}
        >
          <header className="flex flex-wrap items-start gap-3 px-3 md:px-5 pt-4 pb-2">
            <div className="min-w-0 flex-1">
              <h1 className="flex flex-wrap items-baseline gap-x-3 text-lg font-semibold">
                Fleet
                <span className="text-sm font-normal text-muted-foreground">
                  {compact
                    ? `${model.shown} of ${model.total} ${filters.state === "archived" ? "archived" : "open"} · ${model.attention.length} need attention`
                    : `Showing ${model.shown} of ${model.total} ${filters.state === "archived" ? "archived" : "open"} threads on these sources · ${model.attention.length} need attention${model.attention.length !== model.counts.attention ? ` (of ${model.counts.attention})` : ""}`}
                </span>
              </h1>
            </div>
            {!compact ? (
              <button
                type="button"
                onClick={sidebar.toggleSidebar}
                aria-expanded={sidebar.open}
                className="min-h-9 rounded-md border border-border px-2.5 text-sm hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-foreground"
              >
                Sidebar: {sidebar.open ? "Shown" : "Collapsed"}
              </button>
            ) : null}
            {!compact ? (
              <button
                type="button"
                onClick={() =>
                  inspectorOpen ? closeInspector() : setInspectorOpen(true)
                }
                aria-expanded={Boolean(inspector)}
                disabled={!selected}
                className="min-h-9 rounded-md border border-border px-2.5 text-sm hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-50"
              >
                Details: {inspector ? "Open" : "Closed"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (!hideTitles)
                  setFilters((current) => ({ ...current, query: "" }));
                setHideTitles((value) => !value);
              }}
              className={cn(
                "min-h-11 rounded-full border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-foreground md:min-h-9",
                hideTitles && "bg-surface-selected font-semibold",
              )}
            >
              <span aria-hidden="true">▒ </span>Hide titles in Fleet:{" "}
              {hideTitles ? "On" : "Off"}
            </button>
          </header>

          {hideTitles ? (
            <div
              role="note"
              className="mx-3 mb-2 rounded-md border border-dotted border-muted-foreground px-3 py-1.5 text-sm md:mx-5"
            >
              Hide titles applies to Fleet only in this preview. The app
              sidebar, palette and notifications still show titles.
            </div>
          ) : null}
          {filters.state === "archived" ? (
            <div
              role="status"
              className="mx-3 mb-2 rounded-md border border-dashed border-border px-3 py-1.5 text-sm md:mx-5"
            >
              {archived.isPending
                ? "Loading archived threads…"
                : archived.isError
                  ? "Couldn't load archived threads."
                  : archived.data?.archivedTruncated
                    ? `Showing the newest ${archived.data.archivedThreads.length} of ${archived.data.archivedCount} archived threads.`
                    : `All ${archived.data?.archivedCount ?? 0} archived threads.`}
            </div>
          ) : null}
          {model.source === "loading" ? (
            <div
              role="status"
              className="mx-3 mb-2 rounded-md border border-dashed border-border px-3 py-1.5 text-sm md:mx-5"
            >
              Loading fleet details (side chats, workflow workers, archived,
              configured models)…
            </div>
          ) : null}
          {model.source === "fixture" ? (
            <div
              role="note"
              className="mx-3 md:mx-5 mb-2 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm"
            >
              <b>Sample fixture.</b>{" "}
              {compact ? (
                "Demo data, not live."
              ) : (
                <>
                  Controlled demo data from the demo server (
                  <span className="font-mono text-xs">
                    DEMO_FLEET_FIXTURE=1
                  </span>
                  ). Counts, models and states are not live telemetry. The app
                  sidebar shows the same sample data.
                </>
              )}
            </div>
          ) : model.pendingFields.size > 0 ? (
            <div
              role="note"
              className="mx-3 md:mx-5 mb-2 rounded-md border border-dotted border-muted-foreground px-3 py-1.5 text-sm"
            >
              This server doesn't report{" "}
              {[...model.pendingFields]
                .map((field) => PENDING_WORDS[field])
                .join(", ")}{" "}
              yet. Cards say "not reported" instead of guessing.
            </div>
          ) : null}

          {compact ? (
            <p className="mx-3 mt-1 text-xs text-muted-foreground">
              Not available here:{" "}
              {hideTitles
                ? "some sources (names hidden)"
                : model.unavailableSources.join("; ")}
              .
            </p>
          ) : null}
          <CompactDisclosure
            compact={compact}
            label={`Coverage · Cloud ${model.counts.byLocation.cloud ?? 0} · ${hostList.length} machines · freshness`}
          >
            <p className="px-3 md:px-5 text-xs text-muted-foreground">
              Covers{" "}
              <b className="font-medium text-foreground">
                Cloud ({model.counts.byLocation.cloud ?? 0})
              </b>
              {hostList.map((host) => (
                <span key={host.id}>
                  {" · "}
                  <b className="font-medium text-foreground">
                    {redact.host(host.id, host.name)} (
                    {model.counts.byLocation[`host:${host.id}`] ?? 0},{" "}
                    {host.status === "connected" ? "online" : "offline"})
                  </b>
                </span>
              ))}
              {" · "}includes{" "}
              {
                model.threads.filter(
                  (thread) => thread.kind === "side-chat" && !thread.archived,
                ).length
              }{" "}
              side chats and{" "}
              {
                model.threads.filter(
                  (thread) => thread.kind === "workflow" && !thread.archived,
                ).length
              }{" "}
              workflow workers. Archived ({archivedLabel}): State filter. Not
              available here:{" "}
              {hideTitles
                ? "some sources (names hidden)"
                : model.unavailableSources.join("; ")}
              . Freshness:{" "}
              {model.source === "fixture" ? "sample timestamps; " : ""}
              {connection === "connected"
                ? "list updates via realtime (connected)"
                : `realtime ${connection}, list may be stale`}
              {supplementAge
                ? ` · details fetched ${supplementAge}`
                : supplement.isError
                  ? " · details unavailable"
                  : " · details loading"}
              .
            </p>
          </CompactDisclosure>

          <div
            role="group"
            aria-label="State filters"
            className={cn(
              "mx-3 md:mx-5 mt-2 flex rounded-md border border-border font-mono text-xs",
              compact
                ? "flex-nowrap overflow-x-auto"
                : "flex-wrap overflow-hidden",
            )}
          >
            {(
              [
                ["attention", "◆ NEEDS ATTENTION", model.counts.attention],
                ["working", "◐ WORKING", model.counts.working],
                ["connecting", "↻ CONNECTING", model.counts.connecting],
                ["idle", "○ IDLE", model.counts.idle],
                ["archived", "ARCHIVED", archivedLabel],
              ] as const
            ).map(([state, label, count]) => (
              <button
                key={state}
                type="button"
                aria-pressed={filters.state === state}
                onClick={() => setState(state)}
                className={cn(
                  "min-h-11 border-r border-border px-3 whitespace-nowrap hover:bg-state-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground md:min-h-8",
                  filters.state === state &&
                    "bg-surface-selected text-foreground shadow-[inset_0_-2px_0_var(--color-foreground)]",
                )}
              >
                {label} <b className="text-foreground">{count}</b>
              </button>
            ))}
            <span
              className={cn(
                "flex min-h-8 flex-1 items-center justify-end gap-3 px-3 whitespace-nowrap text-muted-foreground",
                compact && "hidden",
              )}
            >
              <span>
                SANDBOX: awake{" "}
                <b className="text-foreground">{model.counts.awake}</b> (
                {Object.entries(model.counts.awakeByHarness).map(
                  ([harness, n], i) =>
                    `${i ? " · " : ""}${harnessName(harness, providers)} ${n}`,
                )}
                ) ·{" "}
                <button
                  type="button"
                  aria-pressed={filters.state === "not-awake"}
                  onClick={() => setState("not-awake")}
                  className={cn(
                    "min-h-8 rounded px-1.5 hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-foreground",
                    filters.state === "not-awake" &&
                      "bg-surface-selected text-foreground shadow-[inset_0_-2px_0_var(--color-foreground)]",
                  )}
                >
                  ☾ not awake{" "}
                  <b className="text-foreground">{model.counts.notAwake}</b>
                </button>{" "}
                · unknown{" "}
                <b className="text-foreground">{model.counts.sandboxUnknown}</b>
              </span>
            </span>
          </div>

          {compact ? (
            <p className="flex flex-wrap items-center gap-x-2 px-3 pt-1 font-mono text-xs text-muted-foreground md:px-5">
              SANDBOX awake {model.counts.awake} ·
              <button
                type="button"
                aria-pressed={filters.state === "not-awake"}
                onClick={() => setState("not-awake")}
                className={cn(
                  "min-h-11 rounded border border-border px-2",
                  filters.state === "not-awake" &&
                    "bg-surface-selected text-foreground",
                )}
              >
                ☾ not awake {model.counts.notAwake}
              </button>
              · unknown {model.counts.sandboxUnknown}
            </p>
          ) : null}
          <CompactDisclosure
            compact={compact}
            label={`Search, filters and sort${filters.query || filters.projectIds.size || filters.locations.size || filters.harnesses.size ? " (active)" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-2 px-3 md:px-5 py-2">
              <label className="flex min-h-11 w-64 items-center gap-2 rounded-md border border-border px-2.5 text-sm md:min-h-9">
                <span aria-hidden="true" className="text-muted-foreground">
                  ⌕
                </span>
                <input
                  ref={searchRef}
                  type="search"
                  value={filters.query}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      query: event.target.value,
                    }))
                  }
                  placeholder="Search in Fleet"
                  aria-label="Search fleet threads"
                  className="min-w-0 flex-1 bg-transparent outline-none"
                />
                <span
                  aria-hidden="true"
                  className="rounded border border-border px-1 font-mono text-xs text-muted-foreground"
                >
                  /
                </span>
              </label>
              <FilterSelect
                label="Project"
                value={[...filters.projectIds][0] ?? ""}
                onChange={(value) => setSingle("projectIds", value)}
                options={model.projectOptions.map((project) => [
                  project.id,
                  `${redact.project(project.id, project.name)}${project.hidden ? " · hidden project" : ""} (${model.counts.byProject[project.id] ?? 0})`,
                ])}
              />
              <FilterSelect
                label="Machine / connection"
                value={[...filters.locations][0] ?? ""}
                onChange={(value) => setSingle("locations", value)}
                options={[
                  ["cloud", `Cloud (${model.counts.byLocation.cloud ?? 0})`],
                  ...hostList.map((host): [string, string] => [
                    `host:${host.id}`,
                    `${redact.host(host.id, host.name)} · ${host.status === "connected" ? "online" : "offline"} (${model.counts.byLocation[`host:${host.id}`] ?? 0})`,
                  ]),
                ]}
              />
              <FilterSelect
                label="Harness"
                value={[...filters.harnesses][0] ?? ""}
                onChange={(value) => setSingle("harnesses", value)}
                options={Object.entries(model.counts.byHarness).map(
                  ([harness, n]) => [
                    harness,
                    `${harnessName(harness, providers)} (${n})`,
                  ],
                )}
              />
              <span className="flex-1" />
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Sort
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as FleetSort)}
                  className="min-h-11 rounded-md border border-border bg-background px-2 text-foreground md:min-h-9"
                >
                  <option value="attention">Attention, then project</option>
                  <option value="latest">Latest activity</option>
                  <option value="title">Project name</option>
                </select>
              </label>
            </div>
          </CompactDisclosure>

          <div
            ref={bodyRef}
            className={cn(
              "min-h-0 flex-1 pb-8",
              compact ? "px-3" : "overflow-y-auto px-5",
            )}
          >
            {model.attention.length > 0 ? (
              <section aria-label="Needs attention">
                <AsciiRule>
                  <span aria-hidden="true">◆</span> NEEDS ATTENTION{" "}
                  <span className="font-normal text-muted-foreground">
                    · {model.attention.length} ·{" "}
                    {attentionGroups
                      .map(
                        ([reason, n]) =>
                          `${ATTENTION_LABELS[reason].toLowerCase()} ${n}`,
                      )
                      .join(" · ")}
                  </span>
                </AsciiRule>
                <div className={GRID}>
                  {model.attention.slice(0, attentionLimit).map((thread) =>
                    card(thread, {
                      lifted: thread.parentId !== null,
                      family: familyById.get(thread.id),
                    }),
                  )}
                </div>
                {attentionLimit < model.attention.length ? (
                  <button
                    type="button"
                    onClick={() => setShowAllAttention(true)}
                    className="mt-2 min-h-11 rounded-md border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-foreground"
                  >
                    Show all {model.attention.length} (showing {attentionLimit})
                  </button>
                ) : null}
              </section>
            ) : null}

            <AsciiRule>BY PROJECT</AsciiRule>
            {model.projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No threads match these filters.
              </p>
            ) : null}
            {sortProjects(model.projects, sort).map((group) => {
              const collapsed = collapsedProjects.has(group.projectId);
              const families = group.families.filter(
                (family) => family.children.length > 0,
              );
              const singles = group.families.filter(
                (family) => family.children.length === 0,
              );
              const liftedSingles = singles
                .filter((family) => group.liftedIds.has(family.thread.id))
                .map((family) => family.thread);
              return (
                <section
                  key={group.projectId}
                  aria-label={`Project ${redact.project(group.projectId, group.projectName)}`}
                  className="mt-1"
                >
                  <button
                    type="button"
                    aria-expanded={!collapsed}
                    onClick={() =>
                      setCollapsedProjects((current) => {
                        const next = new Set(current);
                        if (next.has(group.projectId))
                          next.delete(group.projectId);
                        else next.add(group.projectId);
                        return next;
                      })
                    }
                    className="mt-3 mb-2 flex min-h-11 w-full items-center gap-2 rounded font-mono text-xs text-left hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-foreground md:min-h-8"
                  >
                    <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
                    <b className="text-sm font-semibold text-foreground">
                      {redact.project(group.projectId, group.projectName)}
                    </b>
                    <span className="text-muted-foreground">
                      · {group.total} threads
                      {group.attention
                        ? ` · ${group.attention} need attention (shown above)`
                        : ""}
                      {group.working ? ` · ${group.working} working` : ""}
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex-1 border-t border-border"
                    />
                  </button>
                  {collapsed ? null : (
                    <>
                      {families.map((family) => {
                        const counts = familyCounts(family);
                        const open = !collapsedFamilies.has(family.thread.id);
                        const members = flatten(family, collapsedFamilies);
                        const everyone = flatten(family);
                        const kinds: Record<string, number> = {};
                        for (const { thread } of everyone)
                          kinds[thread.kind] = (kinds[thread.kind] ?? 0) + 1;
                        const lifted = [
                          family.thread,
                          ...everyone.map(({ thread }) => thread),
                        ].filter((thread) => group.liftedIds.has(thread.id));
                        return (
                          <div
                            key={family.thread.id}
                            role="group"
                            aria-label={`Family of ${redact.title(family.thread)}`}
                            className="mb-3 rounded-lg border border-border-seam p-2.5"
                          >
                            <div className="mb-2 truncate font-mono text-xs text-muted-foreground">
                              [ <b className="text-foreground">family</b>{" "}
                              {middleTruncate(redact.title(family.thread), 48)}{" "}
                              ── {counts.total} children: {kindSummary(kinds)}
                              {lifted.length
                                ? ` · ${lifted.length} shown above`
                                : ""}
                              {family.thread.inTurnSubagents
                                ? ` · its ${family.thread.inTurnSubagents} in-turn subagents are activity, not threads`
                                : ""}{" "}
                              ]
                            </div>
                            <div className={GRID}>
                              {group.liftedIds.has(family.thread.id)
                                ? null
                                : card(family.thread, { family })}
                              {open
                                ? members
                                    .filter(
                                      ({ thread }) =>
                                        !group.liftedIds.has(thread.id),
                                    )
                                    .map(({ thread, depth, family: node }) =>
                                      card(thread, {
                                        lifted: depth > 1,
                                        family:
                                          node.children.length > 0
                                            ? node
                                            : undefined,
                                      }),
                                    )
                                : null}
                              {ghost(lifted, `ghost-${family.thread.id}`)}
                            </div>
                          </div>
                        );
                      })}
                      {singles.length > 0 ? (
                        <div className={GRID}>
                          {singles
                            .filter(
                              (family) =>
                                !group.liftedIds.has(family.thread.id),
                            )
                            .map((family) => card(family.thread))}
                          {ghost(
                            liftedSingles,
                            `ghost-singles-${group.projectId}`,
                          )}
                        </div>
                      ) : null}
                    </>
                  )}
                </section>
              );
            })}
            <p className="mt-6 font-mono text-xs text-muted-foreground">
              ←↑↓→ move · ↵/Space open details · ⌘↵ open thread in split · Tab
              reaches ▸ family buttons · N next needs-attention · / search · Esc
              close details
            </p>
          </div>
        </div>
        {inspector ? (
          <FleetInspector
            thread={inspector}
            model={model}
            redact={redact}
            now={now}
            compact={compact}
            onClose={closeInspector}
            onOpen={open}
            onSelect={select}
          />
        ) : null}
      </div>
    </FleetProvidersContext.Provider>
  );
}

const KIND_PLURALS: Record<string, [string, string]> = {
  child: ["child thread", "child threads"],
  "side-chat": ["side chat", "side chats"],
  workflow: ["workflow worker", "workflow workers"],
  fork: ["fork", "forks"],
  plugin: ["plugin thread", "plugin threads"],
};

function kindSummary(kinds: Record<string, number>): string {
  return Object.entries(KIND_PLURALS)
    .filter(([kind]) => (kinds[kind] ?? 0) > 0)
    .map(
      ([kind, [one, many]]) =>
        `${kinds[kind]} ${kinds[kind] === 1 ? one : many}`,
    )
    .join(" + ");
}

function CompactDisclosure({
  compact,
  label,
  children,
}: {
  compact: boolean;
  label: string;
  children: React.ReactNode;
}) {
  if (!compact) return <>{children}</>;
  return (
    <details className="mx-3 md:mx-5 mt-2 rounded-md border border-border">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm text-foreground">
        {label}
      </summary>
      <div className="-mx-3 md:mx-5 pb-2">{children}</div>
    </details>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span className="sr-only md:not-sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 max-w-56 rounded-md border border-border bg-background px-2 text-foreground md:min-h-9"
      >
        <option value="">All</option>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
