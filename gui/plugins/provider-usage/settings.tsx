import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@cloudroom/shared-ui/button";
import { Icon } from "@cloudroom/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cloudroom/shared-ui/dropdown-menu";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import type { providerUsageRpcContract } from "./server.js";
import { UsageDetails } from "./usage-details.js";
import { selectUsageMachine, type UsageMachine } from "./usage-schema.js";

interface UsageLocation {
  id: string;
  name: string;
  kind: "host" | "source";
  disabled: boolean;
}

function UsageLocationPicker({
  locations,
  selectedLocationId,
  onSelectLocation,
}: {
  locations: readonly UsageLocation[];
  selectedLocationId: string | null;
  onSelectLocation: (locationId: string) => void;
}) {
  const selectedLocation =
    locations.find((location) => location.id === selectedLocationId) ??
    locations[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-w-48 gap-1.5"
          aria-label="Usage source"
        >
          <Icon
            name={selectedLocation?.kind === "source" ? "Layers" : "Laptop"}
            className="size-3.5 shrink-0"
          />
          <span className="min-w-0 truncate">
            {selectedLocation?.name ?? "Source"}
          </span>
          <Icon name="ChevronDown" className="size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" mobileTitle="Usage source">
        {locations.map((location) => {
          const connected = !location.disabled;
          return (
            <DropdownMenuItem
              key={location.id}
              disabled={!connected}
              onSelect={() => onSelectLocation(location.id)}
              className="flex items-center gap-2"
            >
              <Icon
                name={location.kind === "source" ? "Layers" : "Laptop"}
                className="size-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate">{location.name}</span>
              {location.id === selectedLocation?.id ? (
                <Icon name="Check" className="size-3.5 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UsageSettingsContent({
  machines,
  selectedId,
  loading,
  error,
  onSelect,
  onRefresh,
}: {
  machines: UsageMachine[];
  selectedId: string | null;
  loading: boolean;
  error: boolean;
  onSelect: (machineId: string) => void;
  onRefresh: () => void;
}) {
  const selected = selectUsageMachine(machines, selectedId, null);
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:gap-4 sm:items-start">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 className="min-w-0 text-sm font-semibold text-foreground">
              Usage limits
            </h2>
          </div>
          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
            Your provider subscription usage.
          </p>
        </div>
        <div className="shrink-0 self-start">
          <div className="flex items-center gap-1">
            {machines.length > 1 ? (
              <UsageLocationPicker
                locations={machines.map((machine) => ({
                  id: machine.id,
                  name: machine.displayName,
                  kind: machine.id.startsWith("source:") ? "source" : "host",
                  disabled: machine.status !== "connected",
                }))}
                selectedLocationId={selected?.id ?? null}
                onSelectLocation={onSelect}
              />
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              disabled={loading}
              onClick={onRefresh}
              aria-label={
                loading ? "Reloading usage data" : "Reload usage data"
              }
            >
              <Icon
                name="RotateCcw"
                className={cn("size-3.5", loading && "animate-spin")}
              />
            </Button>
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card px-4 py-3.5">
        <UsageDetails machine={selected} loading={loading} error={error} />
      </div>
    </section>
  );
}

export function UsageSettings() {
  const rpc = useRpc<typeof providerUsageRpcContract>();
  const [machines, setMachines] = useState<UsageMachine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const forceGeneration = useRef(0);
  useEffect(() => {
    let disposed = false;
    let running = false;
    const force = refresh > forceGeneration.current;
    forceGeneration.current = refresh;
    async function load(force: boolean) {
      if (running) return;
      running = true;
      setLoading(true);
      setError(false);
      try {
        const inventory = await rpc.call("getUsage", {
          force: false,
          machineIds: null,
          providerId: null,
          maxAgeMs: 60_000,
        });
        if (disposed) return;
        setMachines(inventory.machines);
        const selected = selectUsageMachine(
          inventory.machines,
          selectedId,
          null,
        );
        if (selected && selected.status === "connected") {
          for (const providerId of new Set(
            selected.providers.map((provider) => provider.providerId),
          )) {
            const result = await rpc.call("getUsage", {
              force,
              machineIds: [selected.id],
              providerId,
              maxAgeMs: 60_000,
            });
            if (disposed) return;
            setMachines(result.machines);
          }
        }
      } catch {
        if (!disposed) setError(true);
      } finally {
        running = false;
        if (!disposed) setLoading(false);
      }
    }
    void load(force);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [rpc, selectedId, refresh]);
  return (
    <UsageSettingsContent
      machines={machines}
      selectedId={selectedId}
      loading={loading}
      error={error}
      onSelect={setSelectedId}
      onRefresh={() => setRefresh((value) => value + 1)}
    />
  );
}
