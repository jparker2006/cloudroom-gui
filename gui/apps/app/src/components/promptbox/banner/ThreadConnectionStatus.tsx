import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Icon } from "@cloudroom/shared-ui/icon";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import { useServerConnectionState } from "@/hooks/useServerConnectionState";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { useElapsedWhile, useServerConnectionGracePeriodElapsed } from "@/hooks/queries/connection-aware-query-state";
import { wsManager } from "@/lib/ws";
import {
  checkMacAgain,
  getLastMacProbe,
  isMacUnreachableThroughRelay,
  onRelayFreshRead,
  relayFeedLostAt,
  subscribeMacProbe,
  subscribeRelayFeeds,
} from "@/cloud/cloud-server";
import {
  getStaleConversationLabel,
  getThreadConnectionStatus,
  type ThreadConnectionAction,
  type ThreadConnectionStatusView,
} from "@/lib/thread-connection-status";
import { AnimatedBody } from "./AnimatedBody";
import { BannerActionSlot, PromptBannerActionButton } from "./prompt-banner-actions";
import {
  PromptStackCard,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PROMPT_STACK_INLAY_INSET_CLASS,
  PROMPT_STACK_INLAY_SEGMENT_CLASS,
} from "./PromptStackCard";

const RECOVERED_FLASH_MS = 4000;
const REFRESH_COOLDOWN_MS = 3000;

const TONE_ICON_CLASS: Record<ThreadConnectionStatusView["tone"], string> = {
  neutral: "text-muted-foreground",
  attention: "text-warning",
  problem: "text-destructive",
  ok: "text-success",
};

const ACTION_LABEL: Record<ThreadConnectionAction, string> = {
  "refresh-connection": "Refresh connection",
  "refresh-status": "Refresh status",
  "retry-start": "Retry start",
  connect: "Connect",
  "check-mac": "Check again",
};

const CONNECTION_KINDS: ReadonlySet<ThreadConnectionStatusView["kind"]> = new Set([
  "reconnecting",
  "not-connected",
  "browser-offline",
  "status-unreadable",
  "cloud-reconnecting",
  "relay-unreachable",
  "relay-mac-answered",
  "recovered",
]);

export const PROMPT_BANNER_TOUCH_TARGET_CLASS =
  "relative after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] sm:after:-inset-y-1";

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useBrowserOffline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => !navigator.onLine,
    () => false,
  );
}

export function useRecoveredFlash(problemShown: boolean): boolean {
  const hadProblem = useRef(false);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    if (problemShown) {
      hadProblem.current = true;
      return;
    }
    if (!hadProblem.current) return;
    hadProblem.current = false;
    setRecovered(true);
    const timer = setTimeout(() => setRecovered(false), RECOVERED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [problemShown]);
  return recovered && !problemShown;
}

interface HeldStaleCopy {
  label: string;
  queryClient: QueryClient;
  freshReadStarted: boolean;
  unsubscribe: () => void;
}

const heldStaleCopies = new Map<string, HeldStaleCopy>();
const heldStaleListeners = new Set<() => void>();

function emitHeldStaleCopies(): void {
  for (const listener of heldStaleListeners) listener();
}

function subscribeHeldStaleCopies(listener: () => void): () => void {
  heldStaleListeners.add(listener);
  return () => heldStaleListeners.delete(listener);
}

function requestFreshTimelineRead(queryClient: QueryClient, threadId: string): void {
  void queryClient.invalidateQueries({ queryKey: threadTimelineQueryKey(threadId), exact: true }, { cancelRefetch: false });
}

function releaseStaleCopy(threadId: string): void {
  const held = heldStaleCopies.get(threadId);
  if (!held) return;
  held.unsubscribe();
  heldStaleCopies.delete(threadId);
  emitHeldStaleCopies();
}

function holdStaleCopy(queryClient: QueryClient, threadId: string, label: string): void {
  const current = heldStaleCopies.get(threadId);
  if (current?.queryClient === queryClient) {
    current.freshReadStarted = false;
    if (current.label !== label) {
      current.label = label;
      emitHeldStaleCopies();
    }
    return;
  }
  current?.unsubscribe();
  const queryHash = JSON.stringify(threadTimelineQueryKey(threadId));
  const held: HeldStaleCopy = { label, queryClient, freshReadStarted: false, unsubscribe: () => {} };
  if (isMacUnreachableThroughRelay()) {
    held.unsubscribe = onRelayFreshRead(threadId, () => releaseStaleCopy(threadId));
    heldStaleCopies.set(threadId, held);
    emitHeldStaleCopies();
    return;
  }
  const stopWatchingConnection = wsManager.onConnectionStateChange(() => {
    if (wsManager.getConnectionState() !== "connected") held.freshReadStarted = false;
  });
  const stopWatchingCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || JSON.stringify(event.query.queryKey) !== queryHash) return;
    const connected = wsManager.getConnectionState() === "connected";
    if (event.action.type === "fetch") {
      held.freshReadStarted = connected;
      return;
    }
    if (event.action.type === "error") {
      held.freshReadStarted = false;
      return;
    }
    if (event.action.type !== "success" || event.action.manual) return;
    if (held.freshReadStarted && connected) {
      releaseStaleCopy(threadId);
      return;
    }
    held.freshReadStarted = false;
    if (connected) requestFreshTimelineRead(queryClient, threadId);
  });
  held.unsubscribe = () => {
    stopWatchingConnection();
    stopWatchingCache();
  };
  heldStaleCopies.set(threadId, held);
  emitHeldStaleCopies();
}

export function useStaleConversationLabel(threadId: string, hasRows: boolean): string | null {
  const queryClient = useQueryClient();
  const socket = useServerConnectionState();
  const socketGraceElapsed = useServerConnectionGracePeriodElapsed();
  const relayLostAt = useSyncExternalStore(subscribeRelayFeeds, () => relayFeedLostAt(threadId), () => null);
  const relayGraceElapsed = useElapsedWhile(relayLostAt !== null);
  const liveLabel = getStaleConversationLabel(
    relayLostAt === null
      ? { socket, graceElapsed: socketGraceElapsed, disconnectedAt: wsManager.getDisconnectedAt(), hasRows }
      : { socket: "reconnecting", graceElapsed: relayGraceElapsed, disconnectedAt: relayLostAt, hasRows },
  );
  const heldLabel = useSyncExternalStore(
    subscribeHeldStaleCopies,
    () => heldStaleCopies.get(threadId)?.label ?? null,
    () => null,
  );
  useEffect(() => {
    if (liveLabel) holdStaleCopy(queryClient, threadId, liveLabel);
  }, [liveLabel, queryClient, threadId]);
  useEffect(() => {
    if (liveLabel || socket !== "connected" || isMacUnreachableThroughRelay()) return;
    const held = heldStaleCopies.get(threadId);
    if (!held || held.freshReadStarted) return;
    if (queryClient.getQueryState(threadTimelineQueryKey(threadId))?.fetchStatus === "fetching") return;
    requestFreshTimelineRead(queryClient, threadId);
  }, [liveLabel, queryClient, socket, threadId]);
  return liveLabel ?? heldLabel;
}

export function StaleConversationMarker({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <p className="mx-auto mt-3 flex w-fit items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground">
      <Icon name="Clock" className="size-3 shrink-0" aria-hidden="true" />
      {label}
    </p>
  );
}

export interface ThreadCloudStatusEvidence {
  statusReadError: Error | null;
  reconnecting: boolean;
  isFetching: boolean;
  refetch: () => void;
  failedStart: boolean;
  startError: string | null;
  providerAuth: string | null;
  retryStartPending: boolean;
  onRetryStart: () => Promise<unknown>;
  onConnect: () => void;
}

export function ThreadConnectionStatus({
  cloud,
  host,
  onlyThreadStates = false,
  detailsExtra,
}: {
  cloud: ThreadCloudStatusEvidence | null;
  host?: { reconnecting: boolean; graceExpiresAt: number | null };
  onlyThreadStates?: boolean;
  detailsExtra?: ReactNode;
}) {
  const socket = useServerConnectionState();
  const graceElapsed = useServerConnectionGracePeriodElapsed();
  const browserOffline = useBrowserOffline();
  const macProbe = useSyncExternalStore(subscribeMacProbe, getLastMacProbe, () => null);
  const evidence = {
    socket,
    graceElapsed,
    browserOffline,
    disconnectedAt: wsManager.getDisconnectedAt(),
    relayMacUnreachable: isMacUnreachableThroughRelay(),
    relayMacProbe: macProbe,
    host,
    cloud: cloud && {
      statusReadError: cloud.statusReadError,
      reconnecting: cloud.reconnecting,
      failedStart: cloud.failedStart,
      startError: cloud.startError,
      providerAuth: cloud.providerAuth,
    },
  };
  const outage = getThreadConnectionStatus({ ...evidence, recovered: false });
  const recovered = useRecoveredFlash(outage?.kind === "not-connected" || outage?.kind === "browser-offline");
  const current = outage ?? getThreadConnectionStatus({ ...evidence, recovered });
  const view = current && onlyThreadStates && CONNECTION_KINDS.has(current.kind) ? null : current;
  const [coolingDown, setCoolingDown] = useState(false);
  const retryingStart = useRef(false);
  useEffect(() => {
    if (!coolingDown) return;
    const timer = setTimeout(() => setCoolingDown(false), REFRESH_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [coolingDown]);
  return (
    <ThreadConnectionStatusBanner
      view={view}
      detailsExtra={view?.kind === "failed-start" ? detailsExtra : undefined}
      isActionDisabled={(action) =>
        action === "retry-start"
          ? Boolean(cloud?.retryStartPending)
          : coolingDown || (action === "refresh-status" && Boolean(cloud?.isFetching))
      }
      onAction={(action) => {
        if (action === "retry-start") {
          if (!cloud || retryingStart.current) return;
          retryingStart.current = true;
          void cloud
            .onRetryStart()
            .catch(() => undefined)
            .finally(() => {
              retryingStart.current = false;
            });
          return;
        }
        if (action === "connect") {
          cloud?.onConnect();
          return;
        }
        setCoolingDown(true);
        if (action === "refresh-connection") wsManager.reconnectNow();
        else if (action === "check-mac") void checkMacAgain();
        else cloud?.refetch();
      }}
    />
  );
}

export function ThreadConnectionStatusBanner({
  view,
  onAction,
  isActionDisabled,
  detailsExtra,
}: {
  view: ThreadConnectionStatusView | null;
  onAction: (action: ThreadConnectionAction) => void;
  isActionDisabled: (action: ThreadConnectionAction) => boolean;
  detailsExtra?: ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const toggleId = useId();
  const bodyId = useId();
  const liveRegion =
    view?.announce === "alert" ? (
      <span role="alert" className="sr-only">
        {view.status}
      </span>
    ) : (
      <span role="status" aria-live="polite" className="sr-only">
        {view?.announce === "polite" ? view.status : ""}
      </span>
    );
  if (!view) return null;
  const hasDetails = view.details.length > 0;
  const label = (
    <>
      <Icon
        name={view.icon}
        className={cn("size-3.5 shrink-0", TONE_ICON_CLASS[view.tone], view.spin && "animate-spin motion-reduce:animate-none")}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate text-foreground">
        {view.status}
        {view.meta ? <span className="text-muted-foreground"> · {view.meta}</span> : null}
      </span>
    </>
  );
  return (
    <>
      {liveRegion}
      <PromptStackCard ariaLabel="Connection status" className="overflow-hidden" style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}>
        <div className={cn("flex items-center gap-0.5 text-xs text-muted-foreground", PROMPT_STACK_INLAY_INSET_CLASS)}>
          {hasDetails ? (
            <button
              type="button"
              id={toggleId}
              aria-expanded={isExpanded}
              aria-controls={bodyId}
              onClick={() => setIsExpanded((value) => !value)}
              className={cn("flex min-w-0 cursor-pointer items-center gap-1.5 text-xs hover:bg-state-hover", PROMPT_STACK_INLAY_SEGMENT_CLASS)}
            >
              {label}
              <Icon
                name="ChevronDown"
                className={cn("size-3.5 shrink-0 text-subtle-foreground transition-transform", isExpanded && "rotate-180")}
                aria-hidden="true"
              />
            </button>
          ) : (
            <div className={cn("flex min-w-0 items-center gap-1.5 text-xs", PROMPT_STACK_INLAY_SEGMENT_CLASS)}>{label}</div>
          )}
          {view.actions.length > 0 ? (
            <BannerActionSlot hideInTiny={false}>
              {view.actions.map((action) => (
                <PromptBannerActionButton
                  key={action}
                  disabled={isActionDisabled(action)}
                  onClick={() => onAction(action)}
                  className={cn(PROMPT_BANNER_TOUCH_TARGET_CLASS, "text-foreground")}
                >
                  {ACTION_LABEL[action]}
                </PromptBannerActionButton>
              ))}
            </BannerActionSlot>
          ) : null}
        </div>
        {hasDetails ? (
          <AnimatedBody collapsedBorder="reserve" id={bodyId} labelledBy={toggleId} isExpanded={isExpanded}>
            <div className="space-y-1.5 px-3 pb-2.5 pt-2 text-xs leading-relaxed text-muted-foreground">
              {view.details.map((detail) => (
                <p key={detail.label} className="whitespace-pre-wrap break-words">
                  <span className="text-foreground">{detail.label}:</span> {detail.text}
                </p>
              ))}
              {detailsExtra}
            </div>
          </AnimatedBody>
        ) : null}
      </PromptStackCard>
    </>
  );
}
