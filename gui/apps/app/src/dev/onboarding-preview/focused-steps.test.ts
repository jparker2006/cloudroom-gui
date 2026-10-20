import { describe, expect, it } from "vitest";
import {
  isVerified,
  makeFixture,
  models,
  receiptFor,
  restoreFixture,
  transition,
} from "./fixtures";

describe("selected focused setup: one question at a time", () => {
  it("requires a provider choice before offering secure connection", () => {
    const choose = makeFixture("provider");
    expect(transition(choose, { type: "connect" })).toBe(choose);
    const chosen = transition(choose, {
      type: "select-provider",
      provider: "claude-code",
    });
    expect(chosen.phase).toBe("provider-connect");
    expect(chosen.provider).toBe("claude-code");
  });

  it("asks for a model only after connection is confirmed, before any project choice", () => {
    const connected = transition(makeFixture("provider-approval"), {
      type: "connected",
    });
    expect(connected.phase).toBe("model");
    expect(
      transition(connected, {
        type: "select-project",
        project: "example/cloud-notes",
      }),
    ).toBe(connected);
  });

  it("asks for verification consent after choosing No project instead of launching a task", () => {
    const chosen = transition(makeFixture("project"), {
      type: "select-project",
      project: "No project",
    });
    expect(chosen.phase).toBe("verification-consent");
    expect(chosen.receipt).toBeNull();
  });

  it("requests repository access only for the explicitly selected repository", () => {
    const chosen = transition(makeFixture("project"), {
      type: "select-project",
      project: "example/cloud-notes",
    });
    expect(chosen.phase).toBe("repo-access");
    const authorized = transition(chosen, { type: "grant-repo" });
    expect(authorized.phase).toBe("verification-consent");
  });
});

describe("focused setup: retrospective checks added after the initial fix", () => {
  it.each(["provider-connect", "model", "verification-consent"] as const)(
    "reopens the saved %s question without advancing it",
    (phase) => {
      const saved = makeFixture(phase);
      expect(restoreFixture(JSON.stringify(saved))).toEqual(saved);
    },
  );

  it("keeps a duplicate provider choice from replacing the first answer", () => {
    const chosen = transition(makeFixture("provider"), {
      type: "select-provider",
      provider: "claude-code",
    });
    expect(
      transition(chosen, { type: "select-provider", provider: "codex" }),
    ).toBe(chosen);
  });

  it("accepts only the fixture model offered for the connected provider", () => {
    const connected = makeFixture("model");
    expect(
      transition(connected, {
        type: "select-model",
        model: "unavailable-model",
      }),
    ).toBe(connected);
    expect(
      transition(connected, { type: "select-model", model: models.codex })
        .phase,
    ).toBe("project");
  });

  it.each(["provider", "model", "project"] as const)(
    "does not launch verification from the %s question",
    (phase) => {
      const state = makeFixture(phase);
      expect(transition(state, { type: "start-verification" })).toBe(state);
    },
  );

  it("does not accept a completed receipt while waiting for verification consent", () => {
    const waiting = makeFixture("verification-consent");
    expect(
      transition(waiting, {
        type: "execution-completed",
        receipt: receiptFor(waiting),
      }),
    ).toBe(waiting);
    expect(isVerified(waiting)).toBe(false);
  });
});
