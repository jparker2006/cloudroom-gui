export type Provider = "codex" | "claude-code";
export type Phase =
  | "identity"
  | "provider"
  | "provider-approval"
  | "project"
  | "repo-access"
  | "repo-denied"
  | "verifying"
  | "approval"
  | "failed"
  | "resumed"
  | "cancelled"
  | "expired"
  | "success";
export const models = {
  codex: "gpt-6.1-sol",
  "claude-code": "claude-sonnet-4-6",
} as const;
export const providerName = (provider: Provider) =>
  provider === "codex" ? "Codex" : "Claude Code";
export type Receipt = {
  operationId: string;
  provider: Provider;
  model: string;
  project: string;
  result: string;
};
export type SetupFixture = {
  version: 1;
  phase: Phase;
  provider: Provider;
  model: string;
  project: "No project" | "example/cloud-notes";
  billing: "unknown" | "subscription";
  operationId: string;
  attempt: number;
  reconciled: boolean;
  receipt: Receipt | null;
};

export const scenarios = {
  identity: "Start here",
  provider: "Connect provider",
  project: "Choose project",
  verifying: "Setup in progress",
  approval: "Approval required",
  failed: "Failed step",
  resumed: "Resumed setup",
  success: "Verified success",
  "repo-denied": "Repository access denied",
  expired: "Authentication expired",
  cancelled: "Cancelled setup",
} as const;
export type Scenario = keyof typeof scenarios;

export function makeFixture(phase: Phase = "identity"): SetupFixture {
  const fixture: SetupFixture = {
    version: 1,
    phase,
    provider: "codex",
    model: models.codex,
    project: "No project",
    billing: "unknown",
    operationId: "fixture-check-001",
    attempt: 1,
    reconciled: false,
    receipt: null,
  };
  if (phase === "success") fixture.receipt = receiptFor(fixture);
  if (phase === "repo-denied") fixture.project = "example/cloud-notes";
  return fixture;
}

export function receiptFor(state: SetupFixture): Receipt {
  return {
    operationId: state.operationId,
    provider: state.provider,
    model: state.model,
    project: state.project,
    result: "CLOUDROOM_SETUP_OK",
  };
}

export function isVerified(state: SetupFixture): boolean {
  const receipt = state.receipt;
  return (
    state.phase === "success" &&
    receipt !== null &&
    receipt.operationId === state.operationId &&
    receipt.provider === state.provider &&
    receipt.model === state.model &&
    receipt.project === state.project &&
    receipt.result === "CLOUDROOM_SETUP_OK"
  );
}

export function activeStep(state: SetupFixture): number {
  if (state.phase === "identity") return 0;
  if (["provider", "provider-approval", "expired"].includes(state.phase))
    return 1;
  if (["project", "repo-access", "repo-denied"].includes(state.phase)) return 2;
  return 3;
}

export type Action =
  | { type: "signed-in" }
  | { type: "select-provider"; provider: Provider }
  | { type: "connect" }
  | { type: "connected" }
  | { type: "select-project"; project: SetupFixture["project"] }
  | { type: "continue-project" }
  | { type: "grant-repo" }
  | { type: "deny-repo" }
  | { type: "no-project" }
  | { type: "approve" }
  | { type: "cancel" }
  | { type: "reconcile"; outcome: "running" | "failed" }
  | { type: "retry" }
  | { type: "execution-completed"; receipt: Receipt };

export function transition(state: SetupFixture, action: Action): SetupFixture {
  switch (action.type) {
    case "signed-in":
      return state.phase === "identity"
        ? { ...state, phase: "provider" }
        : state;
    case "select-provider":
      return state.phase === "provider"
        ? {
            ...state,
            provider: action.provider,
            model: models[action.provider],
            receipt: null,
          }
        : state;
    case "connect":
      return ["provider", "expired"].includes(state.phase)
        ? { ...state, phase: "provider-approval" }
        : state;
    case "connected":
      return state.phase === "provider-approval"
        ? { ...state, phase: "project", billing: "unknown" }
        : state;
    case "select-project":
      return state.phase === "project"
        ? { ...state, project: action.project }
        : state;
    case "continue-project":
      return state.phase === "project"
        ? {
            ...state,
            phase: state.project === "No project" ? "verifying" : "repo-access",
          }
        : state;
    case "grant-repo":
      return state.phase === "repo-access"
        ? { ...state, phase: "verifying" }
        : state;
    case "deny-repo":
      return state.phase === "repo-access"
        ? { ...state, phase: "repo-denied" }
        : state;
    case "no-project":
      return state.phase === "repo-denied"
        ? { ...state, phase: "project", project: "No project" }
        : state;
    case "approve":
      return state.phase === "approval"
        ? { ...state, phase: "verifying" }
        : state;
    case "cancel":
      return ["verifying", "approval", "resumed", "failed"].includes(
        state.phase,
      )
        ? { ...state, phase: "cancelled", receipt: null, reconciled: false }
        : state;
    case "reconcile":
      return ["failed", "resumed", "cancelled"].includes(state.phase)
        ? {
            ...state,
            phase: action.outcome === "running" ? "verifying" : "failed",
            reconciled: true,
          }
        : state;
    case "retry":
      return state.phase === "failed" && state.reconciled
        ? {
            ...state,
            phase: "verifying",
            reconciled: false,
            receipt: null,
            attempt: state.attempt + 1,
            operationId: `fixture-check-${String(state.attempt + 1).padStart(3, "0")}`,
          }
        : state;
    case "execution-completed": {
      if (state.phase !== "verifying") return state;
      const next: SetupFixture = {
        ...state,
        phase: "success",
        receipt: action.receipt,
      };
      return isVerified(next) ? next : state;
    }
  }
}

export function restoreFixture(raw: string | null): SetupFixture | null {
  try {
    const value = JSON.parse(raw ?? "null") as SetupFixture | null;
    if (
      !value ||
      value.version !== 1 ||
      !Object.hasOwn(
        { ...scenarios, "provider-approval": true, "repo-access": true },
        value.phase,
      ) ||
      !Object.hasOwn(models, value.provider) ||
      value.model !== models[value.provider] ||
      !["No project", "example/cloud-notes"].includes(value.project) ||
      !["unknown", "subscription"].includes(value.billing) ||
      !Number.isSafeInteger(value.attempt) ||
      value.attempt < 1 ||
      typeof value.operationId !== "string" ||
      typeof value.reconciled !== "boolean"
    )
      return null;
    if (value.phase === "success" && !isVerified(value)) return null;
    return value.phase === "verifying"
      ? { ...value, phase: "resumed", reconciled: false }
      : value;
  } catch {
    return null;
  }
}
