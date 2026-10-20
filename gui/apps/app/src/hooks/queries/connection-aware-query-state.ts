import { useEffect, useMemo, useState } from "react";
import type { WebSocketConnectionState } from "@/lib/ws";
import { useServerConnectionState } from "../useServerConnectionState";

const CONNECTION_GRACE_PERIOD_MS = 10_000;

export type ConnectionAwareQueryStatus = "loading" | "ready" | "unavailable";

interface ConnectionAwareQuerySnapshot {
  hasResolvedData: boolean;
  isFetching: boolean;
  isLoadingError: boolean;
  isRecoverableLoadingError?: boolean;
}

export interface ConnectionAwareQueryStateArgs extends ConnectionAwareQuerySnapshot {
  serverConnectionState: WebSocketConnectionState;
  connectionGracePeriodElapsed: boolean;
  loadingErrorGracePeriodElapsed: boolean;
}

interface ConnectionAwareQueryState {
  status: ConnectionAwareQueryStatus;
}

export function getConnectionAwareQueryState({
  hasResolvedData,
  isFetching,
  isLoadingError,
  isRecoverableLoadingError = false,
  serverConnectionState,
  connectionGracePeriodElapsed,
  loadingErrorGracePeriodElapsed,
}: ConnectionAwareQueryStateArgs): ConnectionAwareQueryState {
  if (!hasResolvedData && isFetching) {
    return { status: "loading" };
  }

  if (
    !hasResolvedData &&
    isLoadingError &&
    serverConnectionState !== "connected" &&
    !connectionGracePeriodElapsed
  ) {
    return { status: "loading" };
  }

  if (
    !hasResolvedData &&
    isLoadingError &&
    isRecoverableLoadingError &&
    !loadingErrorGracePeriodElapsed &&
    (serverConnectionState === "connected" || !connectionGracePeriodElapsed)
  ) {
    return { status: "loading" };
  }

  if (!hasResolvedData && isLoadingError) {
    return { status: "unavailable" };
  }

  return { status: "ready" };
}

export function useElapsedWhile(active: boolean): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(
      () => setElapsed(true),
      CONNECTION_GRACE_PERIOD_MS,
    );
    return () => clearTimeout(timer);
  }, [active]);

  return elapsed;
}

export function useServerConnectionGracePeriodElapsed(): boolean {
  return useElapsedWhile(useServerConnectionState() !== "connected");
}

export function useConnectionAwareQueryState({
  hasResolvedData,
  isFetching,
  isLoadingError,
  isRecoverableLoadingError,
}: ConnectionAwareQuerySnapshot): ConnectionAwareQueryState {
  const serverConnectionState = useServerConnectionState();
  const connectionGracePeriodElapsed = useServerConnectionGracePeriodElapsed();
  const loadingErrorGracePeriodElapsed = useElapsedWhile(
    !hasResolvedData && isLoadingError && isRecoverableLoadingError === true,
  );

  return useMemo(
    () =>
      getConnectionAwareQueryState({
        hasResolvedData,
        isFetching,
        isLoadingError,
        isRecoverableLoadingError,
        serverConnectionState,
        connectionGracePeriodElapsed,
        loadingErrorGracePeriodElapsed,
      }),
    [
      hasResolvedData,
      isFetching,
      isLoadingError,
      isRecoverableLoadingError,
      serverConnectionState,
      connectionGracePeriodElapsed,
      loadingErrorGracePeriodElapsed,
    ],
  );
}
