import type { IconName } from "@cloudroom/shared-ui/icon";
import type { WebSocketConnectionState } from "./ws";

export type ThreadConnectionAction =
  | "refresh-connection"
  | "refresh-status"
  | "retry-start"
  | "connect"
  | "check-mac";

export interface ThreadConnectionEvidence {
  socket: WebSocketConnectionState;
  graceElapsed: boolean;
  browserOffline: boolean;
  disconnectedAt: number | null;
  recovered: boolean;
  relayMacUnreachable?: boolean;
  cloud: {
    statusReadError: Error | null;
    reconnecting: boolean;
    failedStart?: boolean;
    startError?: string | null;
    providerAuth?: string | null;
  } | null;
}

export interface ThreadConnectionStatusView {
  kind:
    | "reconnecting"
    | "not-connected"
    | "browser-offline"
    | "status-unreadable"
    | "cloud-reconnecting"
    | "failed-start"
    | "provider-auth"
    | "relay-unreachable"
    | "recovered";
  icon: IconName;
  spin: boolean;
  tone: "neutral" | "attention" | "problem" | "ok";
  status: string;
  details: { label: string; text: string }[];
  actions: ThreadConnectionAction[];
  announce: "none" | "polite" | "alert";
}

export function formatClockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function lastUpdateDetail(disconnectedAt: number | null) {
  return {
    label: "Last update",
    text:
      disconnectedAt === null
        ? "None received on this connection yet."
        : `${formatClockTime(disconnectedAt)}. Nothing new has arrived since.`,
  };
}

const DRAFT_DETAIL = { label: "Drafts", text: "Anything in the box below stays on this device." };

export function getThreadConnectionStatus(
  evidence: ThreadConnectionEvidence,
): ThreadConnectionStatusView | null {
  const socketDown = evidence.socket !== "connected";
  if (evidence.browserOffline) {
    return {
      kind: "browser-offline",
      icon: "CloudOff",
      spin: false,
      tone: "attention",
      status: "Your browser reports you're offline",
      details: [lastUpdateDetail(evidence.disconnectedAt), DRAFT_DETAIL],
      actions: ["refresh-connection"],
      announce: "polite",
    };
  }
  if (evidence.socket === "reconnecting" && !evidence.graceElapsed) {
    return {
      kind: "reconnecting",
      icon: "Spinner",
      spin: true,
      tone: "neutral",
      status: "Reconnecting…",
      details: [],
      actions: [],
      announce: "none",
    };
  }
  if (socketDown && evidence.graceElapsed) {
    return {
      kind: "not-connected",
      icon: "CloudOff",
      spin: false,
      tone: "attention",
      status: "Not connected",
      details: [
        lastUpdateDetail(evidence.disconnectedAt),
        {
          label: "Cause",
          text: "Unknown. The live connection closed without a reason. Retrying automatically.",
        },
        DRAFT_DETAIL,
      ],
      actions: ["refresh-connection"],
      announce: "polite",
    };
  }
  const readError = evidence.cloud?.statusReadError ?? null;
  if (readError) {
    return {
      kind: "status-unreadable",
      icon: "CircleQuestion",
      spin: false,
      tone: "attention",
      status: "Couldn't refresh cloud status",
      details: [
        {
          label: "Cause",
          text:
            readError instanceof TypeError
              ? "Unknown. The request didn't get an answer."
              : `Unknown. The server answered: ${readError.message}`,
        },
        DRAFT_DETAIL,
      ],
      actions: ["refresh-status"],
      announce: "polite",
    };
  }
  const cloud = evidence.cloud;
  const startError = cloud?.startError ? [{ label: "Error", text: cloud.startError }] : [];
  if (cloud?.providerAuth) {
    return {
      kind: "provider-auth",
      icon: "UserRound",
      spin: false,
      tone: "attention",
      status: `${cloud.providerAuth} needs authorization`,
      details: [{ label: "Your message", text: "Saved." }, ...startError],
      actions: ["connect"],
      announce: "polite",
    };
  }
  if (cloud?.failedStart) {
    return {
      kind: "failed-start",
      icon: "AlertTriangle",
      spin: false,
      tone: "problem",
      status: "Cloud session didn't start",
      details: [
        startError[0] ?? { label: "Error", text: "No error message was saved." },
        {
          label: "Retry start",
          text: "Starts the session again with your first message. Anything in the box below stays on this device.",
        },
      ],
      actions: ["refresh-status", "retry-start"],
      announce: "alert",
    };
  }
  if (evidence.cloud?.reconnecting) {
    return {
      kind: "cloud-reconnecting",
      icon: "Spinner",
      spin: true,
      tone: "neutral",
      status: "Cloud session reconnecting…",
      details: [],
      actions: ["refresh-status"],
      announce: "polite",
    };
  }
  if (evidence.relayMacUnreachable) {
    return {
      kind: "relay-unreachable",
      icon: "Laptop",
      spin: false,
      tone: "attention",
      status: "Can't reach your Mac",
      details: [
        {
          label: "Cause",
          text: "The phone relay has no connection to your Mac right now. Cloud threads still work here.",
        },
      ],
      actions: ["check-mac"],
      announce: "polite",
    };
  }
  if (evidence.recovered) {
    return {
      kind: "recovered",
      icon: "CircleCheck",
      spin: false,
      tone: "ok",
      status: "Reconnected",
      details: [],
      actions: [],
      announce: "polite",
    };
  }
  return null;
}

export function getStaleConversationLabel({
  socket,
  graceElapsed,
  disconnectedAt,
  hasRows,
}: {
  socket: WebSocketConnectionState;
  graceElapsed: boolean;
  disconnectedAt: number | null;
  hasRows: boolean;
}): string | null {
  if (socket === "connected" || !graceElapsed || !hasRows) return null;
  const since = disconnectedAt === null ? "" : ` from ${formatClockTime(disconnectedAt)}`;
  return `Saved copy${since} · newer messages may be missing`;
}
