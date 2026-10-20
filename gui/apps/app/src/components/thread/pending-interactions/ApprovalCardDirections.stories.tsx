import { useEffect, useState, type ReactNode } from "react";
import type {
  PendingInteraction,
  PendingInteractionApprovalDecision,
  ApprovalPendingInteraction,
} from "@cloudroom/domain";
import {
  PendingInteractionBannerPreview,
  ThreadPendingInteractionBanner,
  type ApprovalCardLayout,
} from "./ThreadPendingInteractionBanner";

export default {
  title: "thread/Pending Interaction/Approval directions",
};

type ResolveMode = "fail" | "hang";

function base(id: string): Omit<ApprovalPendingInteraction, "payload"> {
  return {
    id,
    threadId: "thr_demo",
    turnId: "turn_demo",
    providerId: "codex",
    providerThreadId: "provider-thread-demo",
    providerRequestId: `request-${id}`,
    status: "pending",
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
    resolution: null,
  };
}

const ALL: PendingInteractionApprovalDecision[] = [
  "allow_once",
  "allow_for_session",
  "deny",
];

const command: ApprovalPendingInteraction = {
  ...base("pi_command"),
  payload: {
    kind: "approval",
    reason: "Run a command that updates the remote",
    availableDecisions: ALL,
    subject: {
      kind: "command",
      itemId: "item_cmd",
      command: "git push origin room/approval-cards",
      cwd: "/workspace/cloudroom/gui",
      actions: [],
      sessionGrant: {
        network: { enabled: true },
        fileSystem: { read: [], write: ["/workspace/cloudroom/gui/.git"] },
      },
    },
  },
};

const rawScript =
  "`python3 -m unittest discover -s tests 2>&1 | tail -20\necho '=== bash -n ==='\nbash -n install.sh && echo OK\necho '=== watcher untouched ==='\ngit diff --stat -- watcher.py\nif [ -f \"$HOME/.immortal-agents/telemetry\" ]; then echo LIVE; else echo ABSENT; fi`";

const scriptCommand: ApprovalPendingInteraction = {
  ...base("pi_script"),
  providerId: "acp-cursor",
  payload: {
    kind: "approval",
    reason: "Not in allowlist: bash -n install.sh",
    availableDecisions: ["allow_once", "deny"],
    subject: {
      kind: "command",
      itemId: "item_script",
      command: rawScript,
      cwd: "/Users/someone/Projects/very/deeply/nested/workspace/immortal-agents",
      actions: [
        {
          type: "read",
          command: "cat install.sh",
          name: "install.sh",
          path: "/Users/someone/Projects/very/deeply/nested/workspace/immortal-agents/install.sh",
        },
        {
          type: "search",
          command: "rg telemetry",
          query: "telemetry",
          path: "watcher.py",
        },
      ],
      sessionGrant: null,
    },
  },
};

const fileChange: ApprovalPendingInteraction = {
  ...base("pi_file"),
  payload: {
    kind: "approval",
    reason: "Write apps/app/src/components/promptbox/banner/ContextBanner.tsx",
    availableDecisions: ["allow_for_session", "deny"],
    subject: {
      kind: "file_change",
      itemId: "item_file",
      writeScope: "/workspace/cloudroom/gui/apps/app/src/components/promptbox",
      sessionGrant: {
        network: null,
        fileSystem: {
          read: [],
          write: ["/workspace/cloudroom/gui/apps/app/src/components/promptbox"],
        },
      },
    },
  },
};

const permissionGrant: ApprovalPendingInteraction = {
  ...base("pi_perm"),
  providerId: "claude-code",
  payload: {
    kind: "approval",
    reason:
      "Need write access outside the sandbox. Warning: this path is shared with other projects.",
    availableDecisions: ALL,
    subject: {
      kind: "permission_grant",
      itemId: "item_perm",
      toolName: "Edit",
      permissions: {
        network: { enabled: true },
        fileSystem: {
          read: [
            "/workspace/cloudroom/gui/apps/app",
            "/workspace/cloudroom/gui/packages/core-ui/src",
            "/workspace/cloudroom/gui/packages/domain/src/pending-interactions",
            "/Users/someone/Library/Application Support/Cloudroom/very-long-directory-name-that-keeps-going/and-going/settings.json",
          ],
          write: [
            "/workspace/cloudroom/gui/apps/app/src/components/thread/pending-interactions",
          ],
        },
      },
    },
  },
};

const onceOnly: ApprovalPendingInteraction = {
  ...base("pi_once"),
  payload: {
    kind: "approval",
    reason: null,
    availableDecisions: ["allow_once"],
    subject: {
      kind: "command",
      itemId: "item_once",
      command: "pnpm install --frozen-lockfile",
      cwd: null,
      actions: [],
      sessionGrant: null,
    },
  },
};

const toolUse: ApprovalPendingInteraction = {
  ...base("pi_tool"),
  providerId: "acp",
  payload: {
    kind: "approval",
    reason: null,
    availableDecisions: ALL,
    subject: {
      kind: "tool_use",
      itemId: "call_tool_use",
      tool: "mcp__github__create_issue",
      presentation: {
        label: { pending: "Creating issue", completed: "Created issue" },
        icon: { glyph: "Globe" },
        title: "get-bb/bb · Banner clips long titles",
        detail: "Opens a **bug** issue with the repro steps from this thread.",
        tint: { light: "#2563eb", dark: "#93c5fd" },
      },
    },
  },
};

const resolving: ApprovalPendingInteraction = {
  ...permissionGrant,
  id: "pi_resolving",
  status: "resolving",
  resolution: {
    decision: "allow_for_session",
    grantedPermissions: {
      network: { enabled: true },
      fileSystem:
        permissionGrant.payload.kind === "approval" &&
        permissionGrant.payload.subject.kind === "permission_grant"
          ? permissionGrant.payload.subject.permissions.fileSystem
          : null,
    },
  },
};

function useResolveStub(interactionId: string, mode: ResolveMode | undefined) {
  useEffect(() => {
    if (mode === undefined) return;
    const original = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : String(input);
      if (!url.includes(interactionId)) return original(input, init);
      if (mode === "hang") return new Promise<Response>(() => {});
      return Promise.resolve(
        new Response(
          JSON.stringify({ error: "Host daemon unreachable (demo)" }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      );
    };
    return () => {
      window.fetch = original;
    };
  }, [interactionId, mode]);
}

function Case({
  children,
  hint,
  label,
}: {
  children: ReactNode;
  hint: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <p className="text-xs text-subtle-foreground">{hint}</p>
      {children}
    </div>
  );
}

const CASES: {
  label: string;
  hint: string;
  interaction: PendingInteraction;
  mode?: ResolveMode;
}[] = [
  {
    label: "Command · all three decisions · session grant",
    hint: "Allow for session sends the provider's sessionGrant",
    interaction: command,
  },
  {
    label: "Multi-line script · once or deny",
    hint: "Readable preview plus the exact raw command in details",
    interaction: scriptCommand,
  },
  {
    label: "File change · session or deny",
    hint: "Write root and session grant",
    interaction: fileChange,
  },
  {
    label: "Permission grant · long paths · supplied warning",
    hint: "Real read and write paths, not counts",
    interaction: permissionGrant,
  },
  {
    label: "Allow once only",
    hint: "No reason supplied, no cwd",
    interaction: onceOnly,
  },
  {
    label: "Tool use",
    hint: "Bridge presentation only",
    interaction: toolUse,
  },
  {
    label: "Resolving",
    hint: "Server is delivering Allow for session; all decisions disabled",
    interaction: resolving,
  },
  {
    label: "Submission failure",
    hint: "Click any decision: the stub returns 503 and the error stays visible collapsed",
    interaction: { ...command, id: "pi_fail" },
    mode: "fail",
  },
  {
    label: "Sending",
    hint: "Click any decision: the stub never answers",
    interaction: { ...fileChange, id: "pi_hang" },
    mode: "hang",
  },
];

function StubbedBanner({
  interaction,
  layout,
  mode,
}: {
  interaction: PendingInteraction;
  layout: ApprovalCardLayout;
  mode?: ResolveMode;
}) {
  const [key] = useState(() => `${interaction.id}-${layout}`);
  useResolveStub(interaction.id, mode ?? "fail");
  if (layout === "summary") {
    return (
      <ThreadPendingInteractionBanner
        key={key}
        interaction={interaction}
        threadId={interaction.threadId}
      />
    );
  }
  return (
    <PendingInteractionBannerPreview
      key={key}
      approvalLayout={layout}
      interaction={interaction}
      threadId={interaction.threadId}
    />
  );
}

function Gallery({ layout }: { layout: ApprovalCardLayout }) {
  const params = new URLSearchParams(window.location.search);
  const only = params.get("case");
  const cases =
    only === null ? CASES : CASES.filter((_, i) => String(i) === only);
  return (
    <div className="flex flex-col gap-6 p-4">
      {cases.map((item) => (
        <Case key={item.label} label={item.label} hint={item.hint}>
          <div className="w-full max-w-[760px]">
            <StubbedBanner
              interaction={item.interaction}
              layout={layout}
              mode={item.mode}
            />
          </div>
        </Case>
      ))}
    </div>
  );
}

export function DirectionASummary() {
  return <Gallery layout="summary" />;
}

export function DirectionBDecisions() {
  return <Gallery layout="decisions" />;
}
