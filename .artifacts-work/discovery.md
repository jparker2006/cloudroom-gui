# Artifacts tab: Phase 1 discovery

Scratch notes. Paths are relative to `gui/`. Line numbers are as of commit 37504fb on this branch.

## 1. Which timeline rows carry file evidence, and where status lives

Everything below comes from `packages/server-contract/src/thread-timeline.ts`. The client only sees these projected rows; raw events stay on the server.

| Evidence | Row type (line) | Path field | Status source | Proposed label |
|---|---|---|---|---|
| File write/edit/delete/move | `TimelineFileChangeWorkRow` (`workKind: "file-change"`, L304) | `change.path`, `change.movePath` | `row.status` (`pending`/`completed`/`error`/`interrupted`, L21) **and** `row.approvalStatus` (`waiting_for_approval`/`denied`/null). Also a separate approval row: `TimelineApprovalWorkRow` with `approvalKind: "file-edit"` and `lifecycle` `waiting`/`denied` (L456). | Counts only when `status === "completed" && approvalStatus === null`. `change.kind` is `"add"` → **generated**; `"update"`/`"delete"`/move → **modified** (domain enum `add/delete/update`, `packages/domain/src/provider-event.ts:121`; contract types it as `string \| null`, so unknown or null → **modified**). Failed, interrupted, pending, or denied writes are kept as occurrences with that status. They never earn a label. |
| Image generation | `TimelineImageGenerationWorkRow` (L354) | `path` (nullable) | `status` plus `error` | **generated** only when `status === "completed" && path !== null && error === null`. |
| Image view | `TimelineImageViewWorkRow` (L343) | `path` | `status` | **referenced** |
| File read | `TimelineFileReadWorkRow` (L369) | `path`, with `cmd` alongside | `status` | **referenced** (only when completed) |
| User attachments | `TimelineUserConversationRow.attachments` (`timelineConversationAttachmentsSchema`, L79): `localImagePaths[]`, `localFilePaths[]`, `imageUrls[]` | path strings | Conversation row `turnRequest.status` (`pending`/`accepted`/`rejected`) | Relative stored name → **uploaded**. Absolute path → **referenced**. See §2. |
| Markdown file links | Conversation rows (`text`), mostly assistant rows | Parsed from Markdown hrefs | n/a | **referenced** |
| Nested (subagent) rows | `TimelineDelegationWorkRow.childRows` (L493) | as above | as above | Same rules. `childRef` points to **another thread** and is never followed. |
| Turn children | `TimelineTurnRow.children: TimelineRow[] \| null` (L576) | | | **`null` means collapsed (summary mode)**. See §3. |

Excluded on purpose:
- `command` rows' `activityIntents[type=read]` (`thread-timeline.ts:42`). These are parsed from shell strings. The PNG branch uses them for a click-to-preview action, but they are inference, so they don't establish membership. This needs a decision (see "Decisions needed").
- `search` rows, `tool` rows (`toolArgs` is free-form JSON), and `web-fetch`.

Domain source (`packages/domain/src/provider-event.ts`): item `status` is `pending|completed|failed|interrupted` (L33). The server projection maps `failed` → `error`. `fileChange.changes[]` holds `{path, kind, movePath?, diff?}` (L123). One provider `fileChange` item with N changes becomes N `file-change` rows.

## 2. Attachment identity: uploaded vs absolute-path reference

- Upload: `POST /projects/:id/attachments` → `storeAttachment` (`apps/server/src/services/projects/attachments.ts:150`). It writes `<dataDir>/attachments/<projectId>/<stem>-<Date.now()>-<rand6><ext>` (`buildStoredFilename`, L45). It returns `{type, path: storedName, name, mimeType, sizeBytes}`.
- Prompt input `localFile` has an optional `name/sizeBytes/mimeType` (`packages/domain/src/shared-types.ts:197`). **`parsePromptInput` (`packages/thread-view/src/user-message-parsing.ts:20`) drops them.** The timeline only keeps path strings, so the original filename isn't on the timeline row.
- Validation: `validatePromptAttachmentReferences` only checks **non-absolute, non-URL** paths, via `shouldValidateProjectAttachmentReference` (L100). It requires them to exist in the project attachment dir at send time. Absolute (`/…`, `C:\`) and `scheme:` paths are passed through **unvalidated** as "runtime readable".
- Client classification already exists: `isProjectAttachmentPath` in `apps/app/src/components/thread/timeline/ConversationAttachments.tsx:54`. A relative path opens through `buildProjectAttachmentContentUrl(projectId, path)` (`apps/app/src/lib/file-content-urls.ts:8`).
- **Identity:** the genuine attachment identity is `(projectId, storedPath)`. That path is server-generated and unique per upload. There is no DB attachment id. The attachment is **project-scoped, not thread-scoped**, and `copyProjectAttachments` duplicates it across projects under the same name. Grouping key: `attachment:<projectId>:<storedPath>`.
- **"Uploaded" is only claimed for relative stored paths on accepted user rows.** An absolute path is a **reference**: the user pointed at a file on disk, nothing was uploaded, and the server never validated it.
- Agent-only seeded attachments (for example the harness-switch history file, `thread-harness-switch.ts:175`) carry `visibility: "agent-only"`. `parsePromptInput` skips them, so they never appear. That's correct.
- Display name: the timeline lacks `name`. Options: (a) show the stored basename as-is; (b) strip the `-<13 digits>-<6 base36>` suffix for display only (heuristic, never used as identity); (c) extend `timelineConversationAttachmentsSchema` with a parallel `localFileNames` (a contract change). **Decision needed.** I recommend (a) or (b). (c) touches the server-contract and the CLI output.

## 3. Pagination, collapsed turns, and what "complete" can mean

- Latest page: `useThreadTimeline` → `fetchThreadTimeline` (`apps/app/src/hooks/queries/thread-queries.ts:892`) returns `ThreadTimelineResponse` (`packages/server-contract/src/api/threads.ts:1044`) with `timelinePage` (`timelinePageMetadataSchema`, L900): `hasOlderRows`, `olderCursor {anchorSeq, anchorId}`, `historySnapshot`, `olderRowsSourceSeqEnd`, `contentPage`.
- Older pages: `useThreadTimelineController.loadOlderTimelineRows` (`apps/app/src/components/thread/timeline/useThreadTimelineController.ts:170`) calls `sdk.threads.timeline({beforeAnchorId, beforeAnchorSeq})` and prepends rows with `prependOlderTimelineRows`. **Loaded older rows are React `useState` local to the controller instance** created in `ThreadDetailView.tsx:888`; they're not in the query cache. `hasOlderTimelineRows = olderCursor !== null` (L169). A stale cursor gets a 400, and the controller recovers via `recoverLoadedTimelineAfterStaleCursor`.
- **Collapsed turns:** with `completedTurnDisplay` defaulting to `"collapse"` (`packages/domain/src/completed-turn-display.ts:10`), completed turns come back in summary mode. `turnMessageDetail: "summary"` (`apps/server/src/services/threads/timeline.ts:1443`) sets `children: null` unless the turn is pending or one of the inclusion rules fires (`packages/thread-view/src/apply-turn-message-detail.ts:95`). The terminal assistant message is still emitted. **So most file-change, read, and image rows are NOT in the loaded rows.** They load per turn through `useThreadTimelineTurnSummaryDetails` (`thread-queries.ts:973`). That hook pages its own `olderCursor` to the end and caches with `staleTime: Infinity` under `threadTimelineTurnSummaryDetailsQueryKey({threadId, turnId, sourceSeqStart, sourceSeqEnd})`. It's the same cache entry `LazyTurnRowBody` uses (`ThreadTimelineRows.tsx:1340`), so anything the user has expanded is free.
- **Context-clear epoch:** the server only serves rows after the latest completed context clear (`contextBoundarySeq`, `timeline.ts:1313`, passed as `epochSequenceStart`). Rows before it can't be reached through timeline pagination at all. The client gets `contextBoundarySeq` in the response (`useThreadTimelineController` exposes it).
- `includeNestedRows=true` (`apps/server/src/routes/threads/data.ts:410`) returns full turn details inline, but at full payload weight. That's not suitable for a background scan.
- What the client can honestly know: coverage is complete only when (1) `olderCursor === null`, (2) every turn row in loaded rows has `children !== null` or a cached turn-details entry, and (3) `contextBoundarySeq === null`. Otherwise the tab shows **partial history**, with counts: checked turns / known turns, older pages remaining, and "history before context clear isn't available". Turn count = `kind === "turn"` rows in loaded rows; older pages add unknown turns, so the copy says "earlier turns may contain more".
- No-rescan plan: derive per source row with a `WeakMap<TimelineRow, Occurrence[]>`. Row objects are reused by `applyTimelineDelta` when unchanged. A changed or upserted row is re-derived alone, and turn-details responses are cached by query key. "Check earlier" fetches missing turn details at bounded concurrency (2) through the same query key, then older pages through the controller's `loadOlderTimelineRows`. It never scans automatically in a loop, which follows the db-load-budget rule.

## 4. Source jumps: `useScrollToSearchedMessage`

- Trigger: `navigate(threadRoute, { state: { searchMessageSeq: seq, searchThreadId: threadId } })`. Existing producer: `CommandPalette.tsx:264`. Reader: `readSearchMessageTarget` (`useScrollToSearchedMessage.ts:158`).
- Nested rows: `findDeepestSeqAnchoredRow` (L54) descends `childRows` (delegation) and `children` (turn). If it hits a collapsed turn (`children === null`), it returns null. Separately, `useTimelineSearchExpansionRowIds` (`ThreadTimelineRows.tsx:575`) uses `collectSearchedMessageAncestorRowIds` (L149) to **force-expand** the turn and delegation ancestors containing the seq. `LazyTurnRowBody` then loads details, and the nested `TimelineRowsList` reruns the hook on child rows and finds the leaf. So nested and collapsed targets already work.
- Older rows: if the seq is below the loaded range and `hasOlderRows`, the hook calls `onLoadOlderRows` once per window key (L235–246) and retries as rows arrive.
- **Seq target per occurrence:** use the leaf row's `sourceSeqStart`. For a file-change, that's the file-change row (`sourceSeqStart..End` covers the item). For attachments, the user row seq. For Markdown links, the assistant row seq. Seqs are `meta.seq`, which are immutable thread event sequences, so they stay valid across pages.
- Only same-thread targets: pass `searchThreadId = current threadId`. The hook ignores mismatched thread targets (L214).
- Edge case: if the target predates `contextBoundarySeq`, it can never load. We never produce such occurrences, because we only see post-boundary rows.

## 5. Secondary panel tabs, the compact shelf, and preview/download

- Fixed view tabs: `FixedPanelViewTab = ThreadInfo | GitDiff | PluginPageFixed` in `packages/client-core/src/panel/fixed-panel-tabs-state.ts:199` (zod schemas near L62). `ThreadDetailView.tsx:574` builds `threadFixedViewTabs` and `secondaryPanelFixedTabs` (L1559). `handleSecondaryPanelChange(panel)` takes `ThreadSecondaryPanel = "git-diff" | "thread-info"` (`apps/app/src/lib/thread-secondary-panel.ts`).
- Rendering: `ThreadSecondaryPanel` renders a fixed tab's own `renderContent` when it's provided (`ThreadSecondaryPanel.tsx:685`). `contentFillsRegion` drops the `p-4` scroll slot (L809). The mocks use exactly this.
- Adding "Artifacts" for real requires: a new `artifacts` kind in `FixedPanelViewTab` and its zod schema, handled in client-core's switch statements (`fixed-panel-tabs-state.ts` L680/823/1030, `secondaryPanelTabState.ts` L102/548) and in `useThreadFileTabs.ts:199`. It also needs a `createArtifactsFixedPanelTab()`, `"artifacts"` added to `ThreadSecondaryPanel`, and a fixed-tab destination like `thread-info-fixed-tab-navigation.ts`. Persisted-state parsing is strict, so adding a kind must keep `parseFixedPanelTabsState` backward compatible (old states lack it; `useReconciledFixedPanelTabsState` re-adds fixed tabs).
- Compact/mobile: `CompactSecondaryPanelShelf` (`CompactSecondaryPanelShelf.tsx`) wraps the same `ThreadSecondaryPanel` with `renderAsDrawer`. A fixed tab automatically shows on mobile. Presentation is `"shelf"` for thread-info and `"full"` for others in stories; the real choice happens in `ThreadDetailView`. Artifacts should use `"full"`.
- Openers used in `ThreadDetailView` (all built on `useThreadFileTabs().openTab`):
  - `openWorkspaceFile({path: relativePath, source: {kind: "working-tree"}, lineRange, statusLabel: null}, {viewer})`
  - `openStorageFile({path: relativePath, lineRange})`
  - `openHostFile({path: absolutePath, lineRange})` (cloud checkout)
  - All are wired exactly as `openTimelineImagePreview` does (`ThreadDetailView.tsx:2256`).
- Preview components: `SecondaryPanelFilePreview` in `ThreadStorageFilePreview.tsx` (note: `allowImageDownload` and the 404/`ENOENT` → `not-found` mapping come from the unaccepted PNG commits, so Phase 2 must not depend on them; the base `not-found` view for HTTP 404 predates them), `FilePreview.tsx`, and `WorkspaceFilePreviewTabContent` / `ThreadStorageFilePreviewTabContent` in `ThreadSecondaryPanelTabContent.tsx`.
- Uploaded attachments have **no** panel tab kind today. The timeline chip opens `buildProjectAttachmentContentUrl` in a new browser tab. Plan: same behavior for "Open" and an `<a download>` to that URL for "Download". No new tab kind.
- Missing files: preview shows `not-found` from HTTP 404 or `ENOENT`. The Artifacts row's "missing" state should come from (a) a successful `delete` occurrence being the latest successful write (event evidence), or (b) the preview reporting not-found. We should **not** stat every file eagerly; that's a DB/host load concern.

## 6. Is there an immutable per-event file version? No.

- `TimelineFileChange` = `{path, kind, movePath, diff, diffStats}`. There's no content hash, blob id, or snapshot ref. The domain `fileChange` has the same fields (`provider-event.ts:123`).
- `FilePreview` (`packages/client-core/src/file-preview.ts:56`) = `{kind, path, url, name?, mimeType, content?}`. There's no version.
- Workspace preview sources: `working-tree | head | merge-base(ref)` (L62). These are git refs, not per-event versions.
- Thread storage and host file content endpoints read the current path. The cloud path `cloudFile` (`apps/server/src/services/cloudroom/teleport-local.ts:195`) caches **one** copy per path and overwrites it on each fetch. That's not a version.
- Image generation `result` is retained-output: truncated after 7 days and not on the timeline row (`packages/db/src/retained-event-output.ts`).
- Attachments: `cache-control: private, immutable` (`apps/server/src/routes/projects.ts:110`) and `etag = size-mtime` (`attachments.ts:210`). The brief excludes these as proof. Also, `copyProjectAttachments` can rewrite the same path, so it isn't even strictly immutable.
- **Only `file-change.diff` is genuinely historical.** It's the diff as reported in the event. It's fine to show as "Change from this event", but it isn't a file snapshot, and it may be null or truncated.
- Conclusion: "Open" always means **current file**, labeled "Current file — may differ from when the agent wrote it". The per-occurrence "view change" opens the event's own diff where one exists.

## 7. Path scoping is an external dependency (not built here)

Status (orchestrator, 2026-10-20): the PNG strict-scope work on this branch (37504fb) is **not accepted**. Its owner thread is now at 8b982e1. Reviewers still reject it: the storage-root check fails open through symlinks, and there's a check-then-read race between the separate check and read. Enforcement is moving into the host daemon. So:
- Artifacts will **not** generalize, copy, or weaken `resolveTimelineImagePreviewTarget` / `resolveTimelineImagePreviewRootPath` (`apps/app/src/lib/thread-local-file-links.ts`).
- We won't rebase onto the PNG branch.
- We won't use `resolveThreadLocalFileLink`, which has an `open-host-path` fallback to arbitrary host paths.

What the Artifacts tab needs from the scoping owner (interface only; the implementation is theirs):

```ts
type ArtifactNamespace =
  | { kind: "workspace" }
  | { kind: "thread-storage" }
  | { kind: "cloud-workspace" }
  | { kind: "attachment"; projectId: string };

type ScopedFileResolution =
  | { kind: "allowed"; namespace: ArtifactNamespace["kind"]; key: string; open: OpenTarget; download: DownloadTarget | null }
  | { kind: "rejected"; reason: string };

resolveThreadScopedFile(args: {
  threadId: string;
  namespace: ArtifactNamespace | "infer";
  path: string;
  cwd: string | null;
}): ScopedFileResolution
```

- `key` is the canonical grouping identity: normalized and, for local files, **realpath-resolved by the enforcer**. Artifacts groups by `namespace + key`. It never groups by basename, and it never computes containment itself.
- `"infer"` covers event paths (file-change, read, image, links) whose owner must be decided by the enforcer (workspace vs. this thread's storage vs. cloud checkout). Attachments pass an explicit `attachment` namespace.
- `open` / `download` map onto the existing openers (`openWorkspaceFile` / `openStorageFile` / `openHostFile` / attachment URL). The **read** itself must be enforced server- or daemon-side. A client "allowed" is advisory only, so the check and read happen atomically downstream.
- `rejected.reason` is shown verbatim on the row ("outside scope"). The source history is kept, with no open or download.
- Until the dependency lands, Phase 2 can ship behind a stub that returns `rejected("File preview isn't available yet")` for everything except project attachments. Those already have a server-validated route. Grouping then falls back to `namespace: "unverified"` + the exact normalized absolute path, and the item is labeled "Not verified". It still never groups by basename.

Late results: key all Artifacts state by `threadId`, and drop async results (turn-details scans, resolutions) when the active thread has changed. Same guard pattern as the `activeThreadIdRef` check in `ThreadDetailView.tsx:2139`; query keys already include `threadId`.

## 8. Markdown file links

- Normalization lives in `apps/app/src/components/ui/markdown-local-file-link.ts`:
  - `parseLocalFileHref({absoluteLinks, href})` (L339) handles `file://`, `/abs`, line suffixes, and the `requireLikelyFileBasename` rule for trusted-host.
  - `resolveRelativeLocalFileHref({baseDir, href, rootPath})` (L259) does relative → absolute within the workspace root.
  - `markdown-preview.tsx:494` `resolveMarkdownLocalFileTarget` composes them exactly the way messages do. Message routing is `buildMarkdownMessageLinkRouting` (`markdown-message-link-routing.ts`): trusted-host absolute plus workspace-relative.
- To find hrefs without "arbitrary slash-containing strings", we must parse Markdown link and image nodes (mdast `link`, `image`, `definition`). The app depends on `react-markdown`, not on a standalone parser. `mdast-util-from-markdown@2.0.2` and `remark-parse@11` are in the lockfile only as transitive deps. **Decision needed:** add `mdast-util-from-markdown` (plus `mdast-util-gfm` / `micromark-extension-gfm` for autolinks) as direct app deps, at the same locked versions. The alternative is a renderer-side collector, which is more fragile. I recommend the direct dep.
- Only rows with `role === "assistant"` or `"user"` are scanned. Inline code spans are never treated as links. Every parsed link still goes through the external `resolveThreadScopedFile` (§7).

## Decisions needed before Phase 2

1. Add `mdast-util-from-markdown` (+ GFM) as direct deps for link extraction? (recommend yes)
2. Attachment display name: stored basename vs. stripped suffix vs. contract change? (recommend stored basename, with the original name in a tooltip only if the contract is extended later)
3. Include command `activityIntents` reads? (recommend no: they're inferred from shell strings)
4. "Check earlier" is user-triggered only, with no auto-scan. (recommend yes)
5. Scoping interface shape (§7) must be agreed with the scoping/daemon owner.
