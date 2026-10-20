import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { FleetSupplementResponse } from "@cloudroom/server-contract";
import { apiClient } from "@/lib/api-server";
import { request, requestOptions } from "@/lib/api";

const FLEET_SUPPLEMENT_QUERY_KEY = ["fleet-supplement"] as const;
const SUPPLEMENT_REFRESH_MAX_WAIT_MS = 1_000;

export function useFleetSupplement(bootstrapUpdatedAt: number) {
  const queryClient = useQueryClient();
  const pendingRefresh = useRef<number | null>(null);
  useEffect(() => {
    if (bootstrapUpdatedAt === 0 || pendingRefresh.current !== null) return;
    pendingRefresh.current = window.setTimeout(() => {
      pendingRefresh.current = null;
      void queryClient.invalidateQueries({
        queryKey: FLEET_SUPPLEMENT_QUERY_KEY,
      });
    }, SUPPLEMENT_REFRESH_MAX_WAIT_MS);
  }, [bootstrapUpdatedAt, queryClient]);
  useEffect(
    () => () => {
      if (pendingRefresh.current !== null)
        window.clearTimeout(pendingRefresh.current);
    },
    [],
  );
  return useQuery<FleetSupplementResponse>({
    queryKey: FLEET_SUPPLEMENT_QUERY_KEY,
    queryFn: ({ signal }) =>
      request<FleetSupplementResponse>(
        apiClient["fleet-supplement"].$get(undefined, requestOptions(signal)),
      ),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
}
