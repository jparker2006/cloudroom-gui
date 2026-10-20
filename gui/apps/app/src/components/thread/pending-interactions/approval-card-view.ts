import {
  assertNever,
  buildPendingInteractionApprovalResolution,
  describePendingInteractionToolUse,
  formatPendingInteractionSubjectDetailLines,
  type PendingInteractionToolUseAsk,
} from "@cloudroom/core-ui";
import { extractShellCommandFromString } from "@cloudroom/thread-view";
import type {
  ApprovalPendingInteractionPayload,
  PendingInteraction,
  PendingInteractionApprovalDecision,
  PendingInteractionApprovalSubject,
  PendingInteractionGrantablePermissionProfile,
} from "@cloudroom/domain";

type ApprovalCardSubject = Exclude<
  PendingInteractionApprovalSubject,
  { kind: "plan" }
>;

export interface ApprovalPermissionList {
  network: boolean;
  read: readonly string[];
  write: readonly string[];
}

export interface ApprovalDecisionScope {
  decision: PendingInteractionApprovalDecision;
  duration: "none" | "request" | "session";
  grants: ApprovalPermissionList | null;
}

export interface ApprovalCommandView {
  raw: string;
  formatted: string;
  cwd: string | null;
  actions: readonly string[];
}

export interface ApprovalCardView {
  title: string;
  action: string;
  target: string | null;
  targetIsCode: boolean;
  location: string | null;
  command: ApprovalCommandView | null;
  toolUse: PendingInteractionToolUseAsk | null;
  tool: string | null;
  requested: ApprovalPermissionList | null;
  sessionGrant: ApprovalPermissionList | null;
  decisions: readonly ApprovalDecisionScope[];
  itemId: string;
}

const APPROVAL_DECISION_ORDER: Record<
  PendingInteractionApprovalDecision,
  number
> = { deny: 0, allow_for_session: 1, allow_once: 2 };

export function orderApprovalDecisions(
  decisions: readonly PendingInteractionApprovalDecision[],
): PendingInteractionApprovalDecision[] {
  return [...decisions].sort(
    (left, right) =>
      APPROVAL_DECISION_ORDER[left] - APPROVAL_DECISION_ORDER[right],
  );
}

export function unwrapBacktickedCommand(command: string): string {
  const trimmed = command.trim();
  return trimmed.length > 2 &&
    trimmed.startsWith("`") &&
    trimmed.endsWith("`") &&
    !trimmed.slice(1, -1).includes("`")
    ? trimmed.slice(1, -1)
    : command;
}

export function toApprovalPermissionList(
  profile: PendingInteractionGrantablePermissionProfile | null,
): ApprovalPermissionList | null {
  if (profile === null) {
    return null;
  }
  const list = {
    network: profile.network?.enabled === true,
    read: profile.fileSystem?.read ?? [],
    write: profile.fileSystem?.write ?? [],
  };
  return list.network || list.read.length > 0 || list.write.length > 0
    ? list
    : null;
}

function describeDecisionScope(
  interaction: PendingInteraction,
  decision: PendingInteractionApprovalDecision,
): ApprovalDecisionScope {
  const resolution = buildPendingInteractionApprovalResolution(
    interaction,
    decision,
  );
  if (!("decision" in resolution) || resolution.decision === "deny") {
    return { decision, duration: "none", grants: null };
  }
  return {
    decision,
    duration: decision === "allow_for_session" ? "session" : "request",
    grants: toApprovalPermissionList(resolution.grantedPermissions),
  };
}

function firstLine(value: string): string {
  const [line = ""] = value.split("\n");
  return line;
}

function describeCommand(
  interaction: PendingInteraction,
  subject: Extract<ApprovalCardSubject, { kind: "command" }>,
): ApprovalCommandView {
  const raw = subject.command;
  const formatted = unwrapBacktickedCommand(
    extractShellCommandFromString(raw) ?? raw,
  );
  const actions = formatPendingInteractionSubjectDetailLines(interaction)
    .filter((line) => line.startsWith("Action: "))
    .map((line) => line.slice("Action: ".length))
    .filter((action) => action !== raw && action !== formatted);
  return { raw, formatted, cwd: subject.cwd, actions };
}

export function buildApprovalCardView(
  interaction: PendingInteraction,
  payload: ApprovalPendingInteractionPayload,
  subject: ApprovalCardSubject,
): ApprovalCardView {
  const decisions = orderApprovalDecisions(payload.availableDecisions).map(
    (decision) => describeDecisionScope(interaction, decision),
  );
  const base = {
    decisions,
    itemId: subject.itemId,
    command: null,
    toolUse: null,
    tool: null,
    requested: null,
    sessionGrant: null,
    location: null,
  };
  switch (subject.kind) {
    case "command": {
      const command = describeCommand(interaction, subject);
      return {
        ...base,
        title: payload.reason ?? "Do you want to run this command?",
        action: "Run command",
        target: firstLine(command.formatted),
        targetIsCode: true,
        location: subject.cwd,
        command,
        sessionGrant: toApprovalPermissionList(subject.sessionGrant),
      };
    }
    case "file_change":
      return {
        ...base,
        title: payload.reason ?? "Do you want to make these changes?",
        action: "Change files",
        target: subject.writeScope,
        targetIsCode: subject.writeScope !== null,
        sessionGrant: toApprovalPermissionList(subject.sessionGrant),
      };
    case "permission_grant":
      return {
        ...base,
        title: payload.reason ?? "Do you want to grant this permission?",
        action: "Grant permissions",
        target: subject.toolName,
        targetIsCode: subject.toolName !== null,
        tool: subject.toolName,
        requested: toApprovalPermissionList(subject.permissions),
      };
    case "tool_use": {
      const ask = describePendingInteractionToolUse({ ...payload, subject });
      return {
        ...base,
        title: ask.title,
        action: "Use tool",
        target: ask.headline ?? ask.tool,
        targetIsCode: ask.headline === null,
        toolUse: ask,
        tool: ask.tool,
      };
    }
    default:
      return assertNever(subject);
  }
}
