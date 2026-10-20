import { systemVersionResponseSchema } from "@cloudroom/server-contract";

export const isPhoneRelay = () =>
  window.location.hostname.endsWith(".cloudroom.run");

export function reloadApp(): void {
  window.location.reload();
}

export type MacProbe = "offline" | "reachable" | "unknown";

export async function probeMac(timeoutMs = 4000): Promise<MacProbe> {
  const response = await fetch("/api/v1/system/version", {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);
  if (!response) return "unknown";
  if (
    response.status === 503 &&
    response.headers.get("x-bb-tunnel-offline") === "1"
  )
    return "offline";
  if (!response.ok) return "unknown";
  const body: unknown = await response.json().catch(() => null);
  return systemVersionResponseSchema.safeParse(body).success
    ? "reachable"
    : "unknown";
}

export async function macOffline(timeoutMs = 4000): Promise<boolean> {
  return (await probeMac(timeoutMs)) === "offline";
}

export function keepOfflineCopy(): void {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker
    .register("/sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then(async () => {
      await (
        await caches.open("cloudroom-shell")
      )
        .add("/")
        .catch(() => undefined);
      const files = performance
        .getEntriesByType("resource")
        .map((entry) => new URL(entry.name))
        .filter(
          (url) =>
            url.origin === window.location.origin &&
            url.pathname.startsWith("/assets/"),
        )
        .map((url) => url.href);
      await (
        await caches.open("cloudroom-assets")
      )
        .addAll(files)
        .catch(() => undefined);
    })
    .catch(() => undefined);
}

export function reloadWhenMacGoesOffline(): void {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    void macOffline().then((offline) => {
      if (offline) window.location.reload();
    });
  });
}
