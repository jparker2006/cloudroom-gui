import { getThreadConnectionStatus, type ThreadConnectionEvidence } from "@/lib/thread-connection-status";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { ResponsiveStage } from "./banner-story-stages";
import { ThreadConnectionStatusBanner } from "./ThreadConnectionStatus";

export default {
  title: "promptbox/banner/Connection Status",
};

const noop = () => {};
const DISCONNECTED_AT = new Date(2026, 9, 20, 14, 14).getTime();
const base: ThreadConnectionEvidence = {
  socket: "connected",
  graceElapsed: false,
  browserOffline: false,
  disconnectedAt: null,
  recovered: false,
  cloud: null,
};

const states: { label: string; hint: string; evidence: ThreadConnectionEvidence }[] = [
  { label: "reconnecting", hint: "first 10 s, silent", evidence: { ...base, socket: "reconnecting", disconnectedAt: DISCONNECTED_AT } },
  { label: "not connected", hint: "after the grace period, cause unknown", evidence: { ...base, socket: "reconnecting", graceElapsed: true, disconnectedAt: DISCONNECTED_AT } },
  { label: "browser offline", hint: "navigator.onLine is false", evidence: { ...base, browserOffline: true, disconnectedAt: DISCONNECTED_AT } },
  { label: "status unreadable", hint: "cloud status read failed", evidence: { ...base, cloud: { statusReadError: new TypeError("Failed to fetch"), reconnecting: false } } },
  { label: "cloud reconnecting", hint: "server says reconnecting", evidence: { ...base, cloud: { statusReadError: null, reconnecting: true } } },
  { label: "failed start", hint: "confirmed failedStart; Retry start is explicit", evidence: { ...base, cloud: { statusReadError: null, reconnecting: false, failedStart: true, startError: "Sandbox setup failed: npm install exited with code 1." } } },
  { label: "provider authorization", hint: "cloud authRequired (Codex/Cursor)", evidence: { ...base, cloud: { statusReadError: null, reconnecting: false, providerAuth: "Codex" } } },
  { label: "host reconnecting", hint: "runtime host-reconnecting within grace", evidence: { ...base, host: { reconnecting: true, graceExpiresAt: new Date(2026, 9, 20, 14, 16).getTime() } } },
  { label: "can't reach Mac", hint: "phone relay tunnel-offline probe", evidence: { ...base, relayMacUnreachable: true } },
  { label: "recovered", hint: "shown for 4 s", evidence: { ...base, recovered: true } },
];

export function States() {
  return (
    <StoryCard labelWidth="230px">
      {states.map((state) => (
        <StoryRow key={state.label} label={state.label} hint={state.hint}>
          <ResponsiveStage>
            <ThreadConnectionStatusBanner view={getThreadConnectionStatus(state.evidence)} onAction={noop} isActionDisabled={() => false} />
          </ResponsiveStage>
        </StoryRow>
      ))}
    </StoryCard>
  );
}
