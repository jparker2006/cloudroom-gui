import { describe, expect, it } from "vitest";
import {
  getStaleConversationLabel,
  getThreadConnectionStatus,
  type ThreadConnectionEvidence,
} from "./thread-connection-status";

const DISCONNECTED_AT = new Date(2026, 9, 20, 14, 14).getTime();

const connected: ThreadConnectionEvidence = {
  socket: "connected",
  graceElapsed: false,
  browserOffline: false,
  disconnectedAt: null,
  recovered: false,
  cloud: null,
};

const cloudOk = {
  statusReadError: null,
  reconnecting: false,
};

describe("getThreadConnectionStatus", () => {
  it("shows nothing while the realtime connection and status reads are healthy", () => {
    expect(getThreadConnectionStatus(connected)).toBeNull();
    expect(getThreadConnectionStatus({ ...connected, cloud: cloudOk })).toBeNull();
  });

  it("says only that it is reconnecting during the grace period and stays silent", () => {
    const status = getThreadConnectionStatus({
      ...connected,
      socket: "reconnecting",
      disconnectedAt: DISCONNECTED_AT,
    });
    expect(status).toMatchObject({
      kind: "reconnecting",
      status: "Reconnecting…",
      announce: "none",
      actions: [],
    });
  });

  it("stays quiet while the app makes its first connection", () => {
    expect(getThreadConnectionStatus({ ...connected, socket: "connecting" })).toBeNull();
    expect(
      getThreadConnectionStatus({ ...connected, socket: "connecting", graceElapsed: true })?.kind,
    ).toBe("not-connected");
  });

  it("keeps the cause unknown after the grace period when only the socket closed", () => {
    const status = getThreadConnectionStatus({
      ...connected,
      socket: "reconnecting",
      graceElapsed: true,
      disconnectedAt: DISCONNECTED_AT,
    });
    expect(status?.kind).toBe("not-connected");
    expect(status?.status).toBe("Not connected");
    expect(status?.announce).toBe("polite");
    expect(status?.actions).toEqual(["refresh-connection"]);
    const text = JSON.stringify(status);
    expect(text).toContain("Unknown");
    expect(text).toContain("2:14");
    expect(text).not.toMatch(/login|sign in|expired|host offline|session lost|failed/i);
  });

  it("names the browser only when the browser itself reports offline", () => {
    const status = getThreadConnectionStatus({
      ...connected,
      socket: "reconnecting",
      browserOffline: true,
      disconnectedAt: DISCONNECTED_AT,
    });
    expect(status?.kind).toBe("browser-offline");
    expect(status?.status).toBe("Your browser reports you're offline");
    expect(status?.actions).toEqual(["refresh-connection"]);
  });

  it("does not turn a generic cloud status TypeError into offline or a failed thread", () => {
    const status = getThreadConnectionStatus({
      ...connected,
      cloud: { ...cloudOk, statusReadError: new TypeError("Failed to fetch") },
    });
    expect(status?.kind).toBe("status-unreadable");
    expect(status?.status).toBe("Couldn't refresh cloud status");
    expect(status?.actions).toEqual(["refresh-status"]);
    expect(JSON.stringify(status)).not.toMatch(/offline|failed to start|login/i);
  });

  it("shows the server's status-read message as detail without diagnosing it", () => {
    const status = getThreadConnectionStatus({
      ...connected,
      cloud: { ...cloudOk, statusReadError: new Error("HTTP 502: Bad gateway") },
    });
    expect(status?.kind).toBe("status-unreadable");
    expect(JSON.stringify(status?.details)).toContain("HTTP 502: Bad gateway");
  });

  it("reports cloud reconnecting from server status with a status-only action", () => {
    const status = getThreadConnectionStatus({
      ...connected,
      cloud: { ...cloudOk, reconnecting: true },
    });
    expect(status).toMatchObject({
      kind: "cloud-reconnecting",
      status: "Cloud session reconnecting…",
      actions: ["refresh-status"],
    });
  });

  it("lets the realtime connection outrank cloud status, since cloud reads go through it", () => {
    const status = getThreadConnectionStatus({
      ...connected,
      socket: "reconnecting",
      graceElapsed: true,
      disconnectedAt: DISCONNECTED_AT,
      cloud: { ...cloudOk, statusReadError: new TypeError("Failed to fetch") },
    });
    expect(status?.kind).toBe("not-connected");
  });

  it("confirms recovery once, politely, without claiming the conversation is current", () => {
    const status = getThreadConnectionStatus({ ...connected, recovered: true });
    expect(status).toMatchObject({
      kind: "recovered",
      status: "Reconnected",
      announce: "polite",
      actions: [],
    });
    expect(JSON.stringify(status)).not.toMatch(/up to date|refreshed/i);
  });

  it("never offers a write action for connection or status trouble", () => {
    const states: ThreadConnectionEvidence[] = [
      { ...connected, socket: "connecting", graceElapsed: true },
      { ...connected, socket: "reconnecting", disconnectedAt: DISCONNECTED_AT },
      { ...connected, browserOffline: true },
      { ...connected, cloud: { ...cloudOk, reconnecting: true } },
      { ...connected, cloud: { ...cloudOk, statusReadError: new Error("x") } },
    ];
    for (const evidence of states) {
      for (const action of getThreadConnectionStatus(evidence)?.actions ?? []) {
        expect(["refresh-connection", "refresh-status"]).toContain(action);
      }
    }
  });
});

describe("getThreadConnectionStatus: selected direction-1 states", () => {
  it("shows a confirmed failed start with a separate status refresh and an explicit retry start, announced once", () => {
    const status = getThreadConnectionStatus({
      ...connected,
      cloud: { ...cloudOk, failedStart: true, startError: "Sandbox setup failed: npm install exited with code 1." },
    });
    expect(status).toMatchObject({
      kind: "failed-start",
      status: "Cloud session didn't start",
      tone: "problem",
      actions: ["refresh-status", "retry-start"],
      announce: "alert",
    });
    expect(JSON.stringify(status?.details)).toContain("Sandbox setup failed: npm install exited with code 1.");
  });

  it("names the provider that needs authorization and offers only the existing connect action", () => {
    const status = getThreadConnectionStatus({ ...connected, cloud: { ...cloudOk, providerAuth: "Cursor" } });
    expect(status).toMatchObject({ kind: "provider-auth", status: "Cursor needs authorization", actions: ["connect"] });
    expect(JSON.stringify(status)).not.toMatch(/expired|Cloudroom account|sign in to Cloudroom/i);
  });

  it("says it can't reach the Mac only from the relay's tunnel-offline evidence, without claiming it is off", () => {
    const status = getThreadConnectionStatus({ ...connected, relayMacUnreachable: true });
    expect(status).toMatchObject({ kind: "relay-unreachable", status: "Can't reach your Mac", actions: ["check-mac"] });
    expect(JSON.stringify(status)).not.toMatch(/powered off|is off|asleep/i);
    expect(getThreadConnectionStatus(connected)).toBeNull();
  });

  it("keeps connection trouble ahead of confirmed thread states, and a failed start ahead of cloud reconnecting", () => {
    const failed = { ...cloudOk, failedStart: true, startError: "x", reconnecting: true };
    expect(getThreadConnectionStatus({ ...connected, socket: "reconnecting", graceElapsed: true, cloud: failed })?.kind).toBe("not-connected");
    expect(getThreadConnectionStatus({ ...connected, cloud: failed })?.kind).toBe("failed-start");
  });

  it("offers retry start only for a confirmed failed start", () => {
    const states: ThreadConnectionEvidence[] = [
      { ...connected, socket: "reconnecting", graceElapsed: true },
      { ...connected, cloud: { ...cloudOk, reconnecting: true } },
      { ...connected, cloud: { ...cloudOk, providerAuth: "Codex" } },
      { ...connected, relayMacUnreachable: true },
    ];
    for (const evidence of states) {
      expect(getThreadConnectionStatus(evidence)?.actions ?? []).not.toContain("retry-start");
    }
  });
});

describe("getStaleConversationLabel", () => {
  it("marks the cached conversation as a saved copy only after the grace period", () => {
    const base = { socket: "reconnecting" as const, graceElapsed: false, disconnectedAt: DISCONNECTED_AT, hasRows: true };
    expect(getStaleConversationLabel(base)).toBeNull();
    const label = getStaleConversationLabel({ ...base, graceElapsed: true });
    expect(label).toMatch(/^Saved copy from 2:14\s?PM · newer messages may be missing$/);
  });

  it("does not mark a live or empty conversation", () => {
    expect(getStaleConversationLabel({ socket: "connected", graceElapsed: true, disconnectedAt: null, hasRows: true })).toBeNull();
    expect(getStaleConversationLabel({ socket: "reconnecting", graceElapsed: true, disconnectedAt: DISCONNECTED_AT, hasRows: false })).toBeNull();
  });
});
