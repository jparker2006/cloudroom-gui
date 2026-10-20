import { z } from "zod";
import {
  contextSnapshotSchema,
  BRANCH_LIST_QUERY_MAX_LENGTH,
  changedMessageLenientSchema,
  changedMessageSchema,
  gitBranchNameSchema,
  gitBranchSelectionSchema,
  jsonValueSchema,
} from "@cloudroom/domain";

export {
  BRANCH_LIST_LIMIT_MAX,
  FILE_LIST_LIMIT_MAX,
  FILE_LIST_QUERY_MAX_LENGTH,
} from "@cloudroom/domain";

interface IncludeQueryValidationArgs {
  allowedValues: readonly string[];
  value: string;
}

export function isCommaSeparatedIncludeQueryValue(
  args: IncludeQueryValidationArgs,
): boolean {
  const requestedValues = args.value.split(",");
  return requestedValues.every(
    (value) => value.length > 0 && args.allowedValues.includes(value),
  );
}

export const threadContextWindowUsageSchema = z.object({
  snapshot: contextSnapshotSchema.optional(),
  usedTokens: z.number(),
  modelContextWindow: z.number(),
  estimated: z.boolean(),
  history: z.array(z.number()).optional(),
});
export type ThreadContextWindowUsage = z.infer<
  typeof threadContextWindowUsageSchema
>;

export const recordedCompactionGapSchema = z.enum([
  "ambiguous-legacy",
  "cloud-auto-not-reported",
  "forked",
  "imported-history",
  "provider-unverified",
  "rewound",
  "teleported",
  "unhandled-compaction-event",
]);
export type RecordedCompactionGap = z.infer<typeof recordedCompactionGapSchema>;

export const RECORDED_COMPACTION_GAP_TEXT: Record<
  RecordedCompactionGap,
  string
> = {
  "ambiguous-legacy": "Some older records couldn't be told apart.",
  "cloud-auto-not-reported": "Cloud may not report automatic compactions.",
  forked: "Records copied from the source thread may be incomplete.",
  "imported-history": "Imported history may be missing compaction records.",
  "provider-unverified":
    "This agent doesn't declare compaction support, so some may be missing.",
  rewound: "Edited or rewound messages may have removed some history.",
  teleported: "Part of this thread ran on another machine.",
  "unhandled-compaction-event": "Some compaction events couldn't be placed.",
};

export const recordedCompactionsSummarySchema = z.object({
  revision: z.string(),
  coverage: z.enum(["complete", "partial"]),
  gaps: z.array(recordedCompactionGapSchema),
  completedCount: z.number().int().nonnegative(),
  inProgress: z.boolean(),
});
export type RecordedCompactionsSummary = z.infer<
  typeof recordedCompactionsSummarySchema
>;

export const recordedCompactionEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("compaction"),
    id: z.string(),
    status: z.enum(["completed", "in_progress", "unconfirmed"]),
    startedAt: z.number().nullable(),
    completedAt: z.number().nullable(),
    turnId: z.string().nullable(),
    summary: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("clear"),
    id: z.string(),
    at: z.number(),
  }),
]);
export type RecordedCompactionEntry = z.infer<
  typeof recordedCompactionEntrySchema
>;

export const recordedCompactionsListSchema =
  recordedCompactionsSummarySchema.extend({
    entries: z.array(recordedCompactionEntrySchema),
    truncated: z.boolean(),
  });
export type RecordedCompactionsList = z.infer<
  typeof recordedCompactionsListSchema
>;

export const threadContextUsageStateSchema = z.enum(["reported", "unknown"]);
export type ThreadContextUsageState = z.infer<
  typeof threadContextUsageStateSchema
>;

export const threadContextResponseSchema = z.object({
  usage: threadContextWindowUsageSchema.nullable(),
  usageState: threadContextUsageStateSchema.optional(),
  compactions: recordedCompactionsListSchema.optional(),
});
export type ThreadContextResponse = z.infer<typeof threadContextResponseSchema>;

export { gitBranchNameSchema };

export const unmanagedBranchSpecSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("existing"),
      name: gitBranchNameSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("new"), baseBranch: gitBranchNameSchema })
    .strict(),
]);
export type UnmanagedBranchSpec = z.infer<typeof unmanagedBranchSpecSchema>;

export const unmanagedWorkspaceSchema = z.object({
  type: z.literal("unmanaged"),
  path: z.string().min(1).nullable(),
  branch: unmanagedBranchSpecSchema.optional(),
});

export const managedWorktreeWorkspaceSchema = z.object({
  type: z.literal("managed-worktree"),
  baseBranch: gitBranchSelectionSchema,
});

export const personalWorkspaceSchema = z.object({
  type: z.literal("personal"),
});

export const workspaceArgsSchema = z.discriminatedUnion("type", [
  unmanagedWorkspaceSchema,
  managedWorktreeWorkspaceSchema,
  personalWorkspaceSchema,
]);
export type WorkspaceArgs = z.infer<typeof workspaceArgsSchema>;

export const reuseEnvironmentSchema = z.object({
  type: z.literal("reuse"),
  environmentId: z.string().min(1),
});

export const hostEnvironmentSchema = z
  .object({
    type: z.literal("host"),
    hostId: z.string().min(1).optional(),
    workspace: workspaceArgsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.workspace.type !== "personal" && value.hostId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "hostId is required unless workspace.type is personal",
        path: ["hostId"],
      });
    }
  });

export const environmentArgsSchema = z.discriminatedUnion("type", [
  reuseEnvironmentSchema,
  hostEnvironmentSchema,
]);
export type EnvironmentArgs = z.infer<typeof environmentArgsSchema>;

export const projectDefaultEnvironmentSchema = z.object({
  type: z.literal("project-default"),
});

export const providerEnvironmentSchema = z.object({
  type: z.literal("provider"),
  environmentProviderId: z.string().min(1),
  machine: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("existing"), hostId: z.string().min(1) }),
      z.object({
        type: z.literal("new"),
        machineProviderId: z.string().min(1),
        inputs: jsonValueSchema.nullable().default(null),
      }),
    ])
    .optional(),
  inputs: jsonValueSchema.nullable().default(null),
});
export type ProviderEnvironmentArgs = z.infer<typeof providerEnvironmentSchema>;

export const environmentProviderInstanceKeySchema = z.string().min(1).max(128);

export const providerReadyEnvironmentSchema = z.discriminatedUnion("type", [
  reuseEnvironmentSchema,
  z.object({
    type: z.literal("host"),
    hostId: z.string().min(1),
    path: z.string().min(1),
    mergeBaseBranch: gitBranchNameSchema.optional(),
    ownsPath: z.boolean().default(true),
  }),
]);
export type ProviderReadyEnvironmentInput = z.input<
  typeof providerReadyEnvironmentSchema
>;

export const createThreadEnvironmentArgsSchema = z.discriminatedUnion("type", [
  reuseEnvironmentSchema,
  hostEnvironmentSchema,
  projectDefaultEnvironmentSchema,
  providerEnvironmentSchema,
]);
export type CreateThreadEnvironmentArgs = z.infer<
  typeof createThreadEnvironmentArgsSchema
>;

export const pathListIncludeQueryValueSchema = z.enum(["true", "false"]);
export type PathListIncludeQueryValue = z.infer<
  typeof pathListIncludeQueryValueSchema
>;

export const branchListQuerySchema = z.object({
  query: z.string().min(1).max(BRANCH_LIST_QUERY_MAX_LENGTH).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

export const serverMessageSchema = changedMessageSchema;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const serverMessageLenientSchema = changedMessageLenientSchema;

export const pluginSignalSchema = z
  .object({
    type: z.literal("plugin-signal"),
    pluginId: z.string().min(1),
    channel: z.string().min(1),
    payload: z.unknown(),
  })
  .strict();
export type PluginSignal = z.infer<typeof pluginSignalSchema>;

export const pluginSignalLenientSchema = z.object({
  type: z.literal("plugin-signal"),
  pluginId: z.string().min(1),
  channel: z.string().min(1),
  payload: z.unknown(),
});

export const workspaceFileSchema = z.object({
  path: z.string(),
  name: z.string(),
});
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;

export const workspacePathEntryKindSchema = z.enum(["file", "directory"]);

export const workspacePathEntrySchema = z.object({
  kind: workspacePathEntryKindSchema,
  path: z.string(),
  name: z.string(),
  score: z.number(),
  positions: z.array(z.number().int().nonnegative()),
});
export type WorkspacePathEntry = z.infer<typeof workspacePathEntrySchema>;

export const workspaceFileListResponseSchema = z.object({
  files: z.array(workspaceFileSchema),
  truncated: z.boolean(),
});
export type WorkspaceFileListResponse = z.infer<
  typeof workspaceFileListResponseSchema
>;

export const workspacePathListResponseSchema = z.object({
  paths: z.array(workspacePathEntrySchema),
  truncated: z.boolean(),
});
export type WorkspacePathListResponse = z.infer<
  typeof workspacePathListResponseSchema
>;

export function rejectMultipleWorkspaceSelectors(
  query: { environmentId?: string; hostId?: string },
  context: z.RefinementCtx,
): void {
  if (query.environmentId !== undefined && query.hostId !== undefined) {
    context.addIssue({
      code: "custom",
      message: "hostId and environmentId are mutually exclusive",
    });
  }
}
