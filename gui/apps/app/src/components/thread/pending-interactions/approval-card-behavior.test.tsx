// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  PendingInteraction,
  PendingInteractionApprovalDecision,
} from "@cloudroom/domain";
import { buildPendingInteractionApprovalResolution } from "@cloudroom/core-ui";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PendingInteractionBannerPreview,
  ThreadPendingInteractionBanner,
} from "./ThreadPendingInteractionBanner";

const mocks = vi.hoisted(() => ({
  resolveMutateAsync: vi.fn(async () => ({})),
  isPending: false,
  error: null as Error | null,
}));

vi.mock("@/hooks/mutations/thread-interaction-mutations", () => ({
  useResolveThreadPendingInteraction: () => ({
    mutateAsync: mocks.resolveMutateAsync,
    isPending: mocks.isPending,
    error: mocks.error,
  }),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useStopThread: () => ({
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { interactions: { respond: vi.fn(), cancel: vi.fn() } } },
}));

const threadId = "thr_approval_test";
const interactionId = "pint_approval_test";
const allDecisions: PendingInteractionApprovalDecision[] = [
  "allow_once",
  "allow_for_session",
  "deny",
];
const decisionLabels: Record<PendingInteractionApprovalDecision, string> = {
  allow_once: "Allow once",
  allow_for_session: "Allow for session",
  deny: "Deny",
};
const sessionGrant = {
  network: { enabled: true },
  fileSystem: { read: ["/workspace/docs"], write: ["/workspace/out"] },
};

const subjectByKind = {
  command: {
    kind: "command",
    itemId: "item_command",
    command: "echo approval",
    cwd: "/workspace",
    actions: [{ type: "unknown", command: "echo approval" }],
    sessionGrant,
  },
  file_change: {
    kind: "file_change",
    itemId: "item_file_change",
    writeScope: "/workspace/src",
    sessionGrant,
  },
  permission_grant: {
    kind: "permission_grant",
    itemId: "item_permission_grant",
    toolName: "browser",
    permissions: sessionGrant,
  },
  tool_use: {
    kind: "tool_use",
    itemId: "item_tool_use",
    tool: "mcp__demo__lookup",
    presentation: {
      label: { pending: "Looking up record", completed: "Looked up record" },
      icon: { glyph: "Globe" },
      title: "record-42",
      detail:
        "Warning: this reads a private record. Confirm it is the right one.",
      tint: { light: "#123456", dark: "#abcdef" },
    },
  },
} as const;

type SubjectKind = keyof typeof subjectByKind;

function approval(
  subjectKind: SubjectKind,
  decisions: readonly PendingInteractionApprovalDecision[] = allDecisions,
  overrides: Partial<PendingInteraction> = {},
): PendingInteraction {
  const subject = subjectByKind[subjectKind];
  return {
    id: interactionId,
    threadId,
    turnId: "turn_approval_test",
    providerId: "acp",
    providerThreadId: "provider_thread",
    providerRequestId: "provider_request",
    status: "pending",
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
    resolution: null,
    payload: {
      kind: "approval",
      reason: `Approve ${subjectKind}?`,
      availableDecisions: [...decisions],
      subject,
    },
    ...overrides,
  } as PendingInteraction;
}

function renderApproval(
  interaction: PendingInteraction,
  approvalLayout: "summary" | "decisions",
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        {approvalLayout === "summary" ? (
          <ThreadPendingInteractionBanner
            interaction={interaction}
            threadId={threadId}
          />
        ) : (
          <PendingInteractionBannerPreview
            approvalLayout={approvalLayout}
            interaction={interaction}
            threadId={threadId}
          />
        )}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const nonemptyDecisionSubsets = Array.from(
  { length: 1 << allDecisions.length },
  (_, mask) => allDecisions.filter((_, index) => (mask & (1 << index)) !== 0),
).filter((subset) => subset.length > 0);

afterEach(() => {
  cleanup();
  mocks.resolveMutateAsync.mockClear();
  mocks.isPending = false;
  mocks.error = null;
});

describe("approval card behavior", () => {
  it("keeps the selected Summary layout when stale preview props request decision rows", () => {
    const interaction = approval("permission_grant");
    const stalePreviewProps = { approvalLayout: "decisions" as const };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ThreadPendingInteractionBanner
            {...stalePreviewProps}
            interaction={interaction}
            threadId={threadId}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      screen
        .getByTestId("approval-summary")
        .getAttribute("data-approval-layout"),
    ).toBe("summary");
    expect(screen.queryByTestId("approval-decision-rows")).toBeNull();
    expect(screen.getByTestId("approval-summary").textContent).toContain(
      "/workspace/out",
    );
    expect(screen.getByTestId("approval-summary").textContent).toContain(
      "/workspace/docs",
    );
    expect(mocks.resolveMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(mocks.resolveMutateAsync).toHaveBeenCalledExactlyOnceWith({
      threadId,
      interactionId,
      resolution: buildPendingInteractionApprovalResolution(
        interaction,
        "deny",
      ),
    });
  });

  it.each(["summary", "decisions"] as const)(
    "%s layout offers and submits every nonempty decision subset for each subject",
    (layout) => {
      for (const subjectKind of Object.keys(subjectByKind) as SubjectKind[]) {
        for (const decisions of nonemptyDecisionSubsets) {
          const interaction = approval(subjectKind, decisions);
          for (const decision of decisions) {
            const view = renderApproval(interaction, layout);
            const offeredButtons = decisions.map((item) =>
              screen.getByRole("button", { name: decisionLabels[item] }),
            );
            expect(offeredButtons).toHaveLength(decisions.length);
            for (const excluded of allDecisions.filter(
              (item) => !decisions.includes(item),
            )) {
              expect(
                screen.queryByRole("button", {
                  name: decisionLabels[excluded],
                }),
              ).toBeNull();
            }
            expect(
              screen
                .getByTestId("approval-summary")
                .getAttribute("data-approval-layout"),
            ).toBe(layout);
            expect(
              screen
                .getByTestId("approval-banner")
                .hasAttribute("data-expanded"),
            ).toBe(false);
            expect(
              screen.getByTestId("approval-details").closest("[hidden]"),
            ).not.toBeNull();

            fireEvent.click(
              screen.getByRole("button", { name: decisionLabels[decision] }),
            );
            expect(mocks.resolveMutateAsync).toHaveBeenCalledWith({
              threadId,
              interactionId,
              resolution: buildPendingInteractionApprovalResolution(
                interaction,
                decision,
              ),
            });
            expect(
              screen
                .getByTestId("approval-banner")
                .hasAttribute("data-expanded"),
            ).toBe(false);
            expect(
              screen.getByTestId("approval-details").closest("[hidden]"),
            ).not.toBeNull();
            view.unmount();
            mocks.resolveMutateAsync.mockClear();
          }
        }
      }
    },
  );

  it.each(["summary", "decisions"] as const)(
    "%s shows requested paths and complete session grants",
    (layout) => {
      renderApproval(approval("permission_grant"), layout);
      const summary = screen.getByTestId("approval-summary");
      expect(summary.textContent).toContain("Requested access");
      expect(summary.textContent).toContain("/workspace/docs");
      expect(summary.textContent).toContain("/workspace/out");
      expect(summary.textContent).toContain("Network access");
      cleanup();
      renderApproval(approval("command"), layout);
      expect(screen.getByTestId("approval-summary").textContent).toContain(
        "/workspace/out",
      );
      expect(screen.getByTestId("approval-summary").textContent).toContain(
        "/workspace/docs",
      );
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
      expect(screen.getByTestId("approval-details").textContent).toContain(
        "/workspace/docs",
      );
      expect(mocks.resolveMutateAsync).not.toHaveBeenCalled();
    },
  );

  it.each([
    [["deny"], null],
    [["allow_once", "deny"], "Allow once applies to this request."],
    [
      ["allow_for_session", "deny"],
      "Allow for session applies for the rest of the session.",
    ],
  ] as const)(
    "summary with %j explains only offered durations",
    (decisions, note) => {
      renderApproval(approval("file_change", decisions), "summary");
      const paragraphs = [
        ...screen.getByTestId("approval-summary").querySelectorAll("p"),
      ].map((paragraph) => paragraph.textContent?.trim() ?? "");
      expect(paragraphs).not.toContain("");
      if (note === null) {
        expect(paragraphs.join(" ")).not.toContain("applies");
      } else {
        expect(paragraphs).toContain(note);
      }
    },
  );

  it("keeps details collapsed and returns focus to the disclosure when Escape is pressed", () => {
    renderApproval(approval("command"), "summary");
    const disclosure = screen.getByRole("button", { name: "Show details" });
    fireEvent.click(disclosure);
    expect(
      screen.getByTestId("approval-details").closest("[hidden]"),
    ).toBeNull();

    fireEvent.keyDown(screen.getByTestId("approval-banner"), { key: "Escape" });

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Show details" }),
    );
    expect(
      screen.getByTestId("approval-details").closest("[hidden]"),
    ).not.toBeNull();
  });

  it("keeps errors visible while the approval details are collapsed", () => {
    mocks.error = new Error("permission service unavailable");
    renderApproval(approval("file_change"), "summary");

    expect(
      screen.getByTestId("pending-interaction-error").textContent,
    ).toContain("permission service unavailable");
    expect(screen.getByTestId("approval-waiting-state").textContent).toContain(
      "Not sent",
    );
    expect(
      screen.getByTestId("approval-details").closest("[hidden]"),
    ).not.toBeNull();
  });

  it("shows supplied tool-use detail and its warning while collapsed", () => {
    renderApproval(approval("tool_use"), "summary");

    expect(
      screen.getByTestId("approval-banner").getAttribute("data-expanded"),
    ).toBeNull();
    const summaryText =
      screen.getByTestId("approval-summary").textContent ?? "";
    expect(summaryText).toContain("Warning: this reads a private record.");
    expect(summaryText).toContain("Confirm it is the right one.");
    expect(
      screen.getByTestId("approval-details").closest("[hidden]"),
    ).not.toBeNull();
  });

  it.each(["`printf 'raw command'`", "printf 'unchanged command'"])(
    "keeps the exact sent command %s in its raw command block",
    (rawCommand) => {
      const interaction = approval("command");
      const payload = interaction.payload;
      if (payload.kind !== "approval" || payload.subject.kind !== "command") {
        throw new Error("Expected a command approval fixture");
      }
      interaction.payload = {
        ...payload,
        subject: { ...payload.subject, command: rawCommand },
      };
      renderApproval(interaction, "summary");

      fireEvent.click(screen.getByRole("button", { name: "Show details" }));

      expect(screen.getByTestId("approval-raw-command").textContent).toBe(
        rawCommand,
      );
    },
  );

  it.each([
    ["summary", "pending"],
    ["summary", "resolving"],
    ["decisions", "pending"],
    ["decisions", "resolving"],
  ] as const)(
    "%s disables every offered decision while %s",
    (layout, status) => {
      if (status === "pending") mocks.isPending = true;
      const interaction = approval("command", allDecisions, { status });
      renderApproval(interaction, layout);

      for (const decision of allDecisions) {
        expect(
          (
            screen.getByRole("button", {
              name: decisionLabels[decision],
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(true);
        fireEvent.click(
          screen.getByRole("button", { name: decisionLabels[decision] }),
        );
      }
      expect(mocks.resolveMutateAsync).not.toHaveBeenCalled();
    },
  );
});
