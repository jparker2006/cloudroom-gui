import { useCallback, useSyncExternalStore } from "react";
import { hashKey, useQueryClient, type Query, type QueryKey } from "@tanstack/react-query";

const refreshFailures = new WeakMap<Query, boolean>();

function readRefreshFailure(query: Query | undefined): boolean {
  if (!query) return false;
  return (
    refreshFailures.get(query) ??
    (query.state.status === "error" || query.state.fetchFailureCount > 0)
  );
}

export function useQueryRefreshFailure(queryKey: QueryKey, enabled = true): boolean {
  const cache = useQueryClient().getQueryCache();
  const queryHash = hashKey(queryKey);
  const subscribe = useCallback(
    (onChange: () => void) =>
      cache.subscribe((event) => {
        if (event.type !== "updated" || event.query.queryHash !== queryHash) return;
        const { action } = event;
        if (action.type === "error") refreshFailures.set(event.query, true);
        else if (action.type === "success" && !action.manual) {
          refreshFailures.set(event.query, false);
        } else return;
        onChange();
      }),
    [cache, queryHash],
  );
  const getSnapshot = () => enabled && readRefreshFailure(cache.get(queryHash));
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
