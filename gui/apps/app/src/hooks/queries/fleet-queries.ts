import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { FleetSupplementResponse } from "@cloudroom/server-contract";
import { apiClient } from "@/lib/api-server";
import { request, requestOptions } from "@/lib/api";

const FLEET_SUPPLEMENT_QUERY_KEY = ["fleet-supplement"] as const;

export function useFleetSupplement(bootstrapUpdatedAt: number) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (bootstrapUpdatedAt === 0) return;
    void queryClient.invalidateQueries({
      queryKey: FLEET_SUPPLEMENT_QUERY_KEY,
    });
  }, [bootstrapUpdatedAt, queryClient]);
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
