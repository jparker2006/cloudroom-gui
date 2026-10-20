import { describe, expect, it } from "vitest";
import {
  isVerified,
  makeFixture,
  models,
  receiptFor,
  restoreFixture,
  transition,
} from "./fixtures";

describe("onboarding design fixtures: retrospective guard checks", () => {
  it("requires a matching completed execution, rather than connection or launch acceptance", () => {
    const state = makeFixture("verifying");
    expect(isVerified(state)).toBe(false);
    expect(isVerified(makeFixture("project"))).toBe(false);
    expect(
      isVerified(
        transition(state, {
          type: "execution-completed",
          receipt: receiptFor(state),
        }),
      ),
    ).toBe(true);
  });

  it.each(["operationId", "model", "provider", "project", "result"] as const)(
    "rejects a receipt for a different %s",
    (key) => {
      const state = makeFixture("verifying");
      const receipt = { ...receiptFor(state), [key]: "another-value" };
      expect(transition(state, { type: "execution-completed", receipt })).toBe(
        state,
      );
    },
  );

  it("does not let a late completion mark a paused operation ready", () => {
    const running = makeFixture("verifying");
    const paused = transition(running, { type: "cancel" });
    expect(
      transition(paused, {
        type: "execution-completed",
        receipt: receiptFor(running),
      }),
    ).toBe(paused);
    expect(isVerified(paused)).toBe(false);
  });

  it("reopens a running operation as uncertain and reconciles without a duplicate attempt", () => {
    const running = makeFixture("verifying");
    const restored = restoreFixture(JSON.stringify(running))!;
    expect(restored.phase).toBe("resumed");
    expect(transition(restored, { type: "retry" })).toBe(restored);
    const recovered = transition(restored, {
      type: "reconcile",
      outcome: "running",
    });
    expect(recovered.phase).toBe("verifying");
    expect(recovered.operationId).toBe(running.operationId);
    expect(recovered.attempt).toBe(1);
  });

  it("requires a confirmed terminal failure before creating one new retry", () => {
    const failed = makeFixture("failed");
    expect(transition(failed, { type: "retry" })).toBe(failed);
    const checked = transition(failed, {
      type: "reconcile",
      outcome: "failed",
    });
    const retry = transition(checked, { type: "retry" });
    expect(retry.phase).toBe("verifying");
    expect(retry.attempt).toBe(2);
    expect(retry.operationId).not.toBe(failed.operationId);
    expect(transition(retry, { type: "retry" })).toBe(retry);
    expect(
      transition(retry, {
        type: "execution-completed",
        receipt: receiptFor(failed),
      }),
    ).toBe(retry);
  });

  it("preserves cancellation until reconciliation", () => {
    const cancelled = transition(makeFixture("approval"), { type: "cancel" });
    const restored = restoreFixture(JSON.stringify(cancelled))!;
    expect(restored.phase).toBe("cancelled");
    expect(transition(restored, { type: "retry" })).toBe(restored);
    expect(
      transition(restored, { type: "reconcile", outcome: "failed" }).reconciled,
    ).toBe(true);
  });

  it("continues without requesting repo access for No project", () => {
    const state = transition(makeFixture("project"), {
      type: "select-project",
      project: "No project",
    });
    expect(state.project).toBe("No project");
    expect(state.phase).toBe("verification-consent");
    expect(transition(state, { type: "start-verification" }).phase).toBe(
      "verifying",
    );
  });

  it("requests repo access only after selection, and recovers from denial with No project", () => {
    const chosen = transition(makeFixture("project"), {
      type: "select-project",
      project: "example/cloud-notes",
    });
    const grant = chosen;
    expect(grant.phase).toBe("repo-access");
    const denied = transition(grant, { type: "deny-repo" });
    expect(denied.phase).toBe("repo-denied");
    const noProject = transition(denied, { type: "no-project" });
    expect(
      transition(noProject, { type: "select-project", project: "No project" })
        .phase,
    ).toBe("verification-consent");
  });

  it("keeps the selected provider and unknown billing through expired authentication", () => {
    const expired = {
      ...makeFixture("expired"),
      provider: "claude-code" as const,
      model: models["claude-code"],
    };
    const connected = transition(transition(expired, { type: "connect" }), {
      type: "connected",
    });
    expect(connected.provider).toBe("claude-code");
    expect(connected.model).toBe(models["claude-code"]);
    expect(connected.billing).toBe("unknown");
    expect(isVerified(connected)).toBe(false);
  });

  it("never substitutes a provider or billing mode after provider failure", () => {
    const failed = makeFixture("failed");
    const retry = transition(
      transition(failed, { type: "reconcile", outcome: "failed" }),
      { type: "retry" },
    );
    expect(retry.provider).toBe(failed.provider);
    expect(retry.billing).toBe("unknown");
    expect(retry.receipt).toBeNull();
  });

  it("preserves an approval across reopening, without treating it as execution", () => {
    const restored = restoreFixture(JSON.stringify(makeFixture("approval")))!;
    expect(restored.phase).toBe("approval");
    const allowed = transition(restored, { type: "approve" });
    expect(allowed.phase).toBe("verifying");
    expect(isVerified(allowed)).toBe(false);
  });

  it("rejects corrupted storage and unverified success", () => {
    expect(restoreFixture("not json")).toBeNull();
    expect(
      restoreFixture(JSON.stringify({ ...makeFixture(), phase: "toString" })),
    ).toBeNull();
    expect(
      restoreFixture(
        JSON.stringify({ ...makeFixture("success"), receipt: null }),
      ),
    ).toBeNull();
  });
});
