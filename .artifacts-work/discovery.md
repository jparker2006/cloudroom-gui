# Artifacts tab: discovery (Phase 1b)

Scratch notes. Paths are relative to `gui/`. Line numbers were checked against `eacc72c` (base `37504fb`).

Path scoping and read enforcement are an **external dependency** owned by the PNG/daemon thread (§7). Artifacts does not generalize, copy, or import the PNG helpers, and does not rebase onto that branch.

---

## 1. Evidence: which rows count, and how

All row shapes come from `packages/server-contract/src/thread-timeline.ts`.

### 1.1 Membership rule

A file **is listed** only if at least one occurrence is *qualifying*:

| Evidence | Row (line) | Qualifying when | Label it earns |
|---|---|---|---|
| File change `kind: "add"` | `file-change` (L304) | `status === "completed" && approvalStatus === null` | **Generated** |
| File change `kind: "update"`, `null`, or unknown | `file-change` | same | **Modified** |
| File change with `movePath` | `file-change` | same | **Modified**, keyed by the new path (§2.3) |
| File change `kind: "delete"` | `file-change` | same | No label. It's a qualifying **"Deleted"** occurrence: the file was part of this thread's work. |
| Image generation | `image-generation` (L354) | `status === "completed" && path !== null && error === null` | **Generated** |
| Image view | `image-view` (L343) | `status === "completed"` | **Referenced** |
| File read | `file-read` (L369) | `status === "completed"` | **Referenced** |
| Markdown link in a conversation row | conversation `text` | Parsed link/image node (§8) | **Referenced** |
| User attachment | user conversation `attachments` (L79) | See §1.3 | **Uploaded to this project** or **Referenced by path** |

**Non-qualifying occurrences** never create a list entry on their own. They're shown **only as occurrences of a file that already qualifies through other evidence**. They are:
- file changes that failed (`error`) or are `pending`, `interrupted`, `waiting_for_approval`, or `denied`;
- failed or pending reads, views, and image generations;
- attachments on pending or rejected user rows.

(The `deploy.config.json` mock qualified through failures only, so it was removed.)

Labels are a union over qualifying occurrences, so a file can be Generated + Modified. Deleted, failed, and pending never become labels.

### 1.2 Deleted vs. missing

- **"Deleted"** is an occurrence verb. It's history at that point in the thread, not proof the file is gone now: the agent may have recreated it, or a later turn may have restored it.
- **"Not available now"** comes **only** from a current read (when the user opens or previews the file) that fails. It's never inferred from events, and nothing is stat'd eagerly.
- Because of §7.5 (no existence oracle), a read that fails as not-found and a read rejected by scope show the **same** text: "Not available now. It may have been moved or deleted, or it's outside this thread's files."

### 1.3 Attachments: "Uploaded" vs. "Referenced"

Facts:
- Uploads go through `storeAttachment` (`apps/server/src/services/projects/attachments.ts:150`). The stored name is `<stem>-<Date.now()>-<rand6><ext>` (`buildStoredFilename`, L45), in a **project**-scoped directory.
- `validatePromptAttachmentReferences` only checks relative paths (`shouldValidateProjectAttachmentReference`, L100).
- **Cloud threads skip validation.** For example, `createQueuedMessageForThread` returns for cloud before validating (`apps/server/src/services/threads/queued-messages.ts:215-224`). Editing a queued message does the same (`apps/server/src/routes/threads/actions.ts:265-269`: the cloud branch returns before `validatePromptAttachmentReferences`).
- The timeline row records neither whether validation ran nor the execution target at send time. `parsePromptInput` (`packages/thread-view/src/user-message-parsing.ts:20`) also drops `name`, `sizeBytes`, and `mimeType`.

**Rule.** "Uploaded to this project" requires **all** of:
1. `row.role === "user"`
2. `row.initiator === "user"`
3. `row.senderThreadId === null`
4. `row.turnRequest.status === "accepted"`
5. A relative stored path: no leading `/`, no drive letter, no scheme. This mirrors `isProjectAttachmentPath` (`apps/app/src/components/thread/timeline/ConversationAttachments.tsx:54`).
6. A **server-supplied proof that validation ran for that send**. That's a dependency requirement (§7.2 item 4); the client can't derive it.

Otherwise:
- Accepted user rows with an absolute path, or an unproven relative one, get **"Referenced by path"**.
- Pending or rejected rows count as non-qualifying occurrences only.
- Agent-only attachments (`visibility: "agent-only"`) never appear, because `parsePromptInput` skips them.

The copy says "to this project", never "to this thread". Attachments are project-scoped and get copied between projects by name (`copyProjectAttachments`).

**Attachment reads are not exempt** from the scoping dependency:
- `resolveAttachmentPath` → `resolveContainedPath` (`attachments.ts:76`) is lexical.
- `readAttachment` does `stat`, then `readFile`, as separate steps (L195-213).
- `immutable` cache headers (`apps/server/src/routes/projects.ts:110`) and the size-mtime ETag don't make it a version.

### 1.4 Approval rows

A `file-edit` message becomes an `approval` row **only when it has no changes and `approvalStatus !== null`** (`packages/thread-view/src/build-thread-timeline.ts:600`). Otherwise it becomes one `file-change` row per change, each carrying `approvalStatus`. An approval row with no changes has no path, so it never contributes a file.

### 1.5 Excluded on purpose

- `command.activityIntents[type=read]` (`thread-timeline.ts:42`). These are parsed from shell strings, so they're inference. Recommendation: **no**.
- Inline-code filenames. The renderer links some of them (`resolveInlineCodeMarkdownFileHref`, `apps/app/src/components/ui/markdown-preview.tsx:576`, used at L794). Artifacts deliberately excludes them: a code span is not a link the author made (§8).
- `search`, `tool` (free-form `toolArgs`), `web-fetch`, and `web-search` rows.
- Delegation `childRef` points to another thread and is never followed. A delegation's own `childRows` are this thread's events, so they're included.

## 2. Identity

### 2.1 History identity vs. read authorization

These are separate. Both are computed by the dependency (§7), from server-derived roots only.

- **History identity** `(owner, historicalPath)` groups occurrences. It's computed once per raw path and never changes with current file-system state. `owner` is one of `workspace`, `thread-storage`, `cloud-workspace`, `attachment`, `outside`, or `unresolved`.
- **Read authorization** is decided at open/download time and enforced inside the read. The result is `allowed` or `unavailable`; missing and rejected look the same to the client.

Rejected, outside, unresolved, and unavailable items **keep their identity and history**. They are **never merged** with an allowed group, even when basenames or strings match.

### 2.2 How each row kind's path becomes an identity

| Row kind | Raw path as delivered | Identity input |
|---|---|---|
| `file-change` | **Relativized by the server against the *current* environment root** (`relativizeWorkspacePath`, `build-thread-timeline.ts:425`; root from `resolveThreadWorkspaceRoot`, `apps/server/src/services/threads/timeline.ts:112`). It stays absolute if it wasn't under the root. | Relative → `workspace` + path, **as asserted by the server at projection time**. It can drift if the environment path changed since the event. Absolute → sent raw to the dependency. |
| `file-read`, `image-view`, `image-generation` | **Raw**, as the provider reported it. These rows have **no cwd**. | Absolute → dependency. Relative → **unresolved**. |
| Markdown link | Href after syntax normalization only (§8) | Absolute or `file://` → dependency. Relative → sent with `evidenceKind: "markdown-link"`; the server resolves it against `environment.path`. The client never joins roots. |
| Attachment (relative stored name) | Stored name | `attachment` owner. `projectId` is derived **server-side from `threadId`**, never supplied by the client. |
| Attachment (absolute path) | Raw | Dependency; it may be outside scope. |

Unverified keys: **never collapse `..` lexically**; keep the raw string, trimmed only of a trailing `/`. Never key on a client-supplied root.

An **unresolvable relative path** (no cwd, no server root) becomes its own group keyed `unresolved:<raw string>`. It's labeled "Not verified" and has no open or download. Its source history and jumps still work.

### 2.3 Moves

For a `file-change` with `movePath`:
- The group key is the **new** path (`movePath`). The occurrence verb is "Moved from `<old>`".
- The old path gets a non-qualifying "Moved to `<new>`" occurrence. It's listed only if the old path already qualifies through other evidence.
- Both raw paths are kept on the occurrence.

### 2.4 Image generation

- Completed, with a path and no error → Generated.
- Failed (`error !== null` or `status === "error"`), interrupted, or pending → a non-qualifying "Image generation failed" or "Generating…" occurrence. It's attached only if `path` is non-null and that path already qualifies; otherwise it's dropped (no path means no file).

### 2.5 Occurrence identity

The occurrence key is `(threadId, sourceSeqStart, callId, changeIndex | linkOrdinal)`:
- `file-change` row ids are `<base>:file-change:<index>` (`build-thread-timeline.ts:622`), which gives `changeIndex`.
- Conversation rows have no `callId`, so the row id is used. `linkOrdinal` is the link's index in the parsed Markdown tree. Attachments use `attachmentIndex`.

The same occurrence can arrive from the latest page, an older page, or turn details. It's **deduped by this key**.

## 3. Completeness and pagination

### 3.1 What is loaded

**Latest page.** `useThreadTimeline` → `fetchThreadTimeline` (`apps/app/src/hooks/queries/thread-queries.ts:892`). The response's `timelinePage` (`packages/server-contract/src/api/threads.ts:900`) carries `hasOlderRows` and `olderCursor`.

**Older pages.** `useThreadTimelineController.loadOlderTimelineRows` (`apps/app/src/components/thread/timeline/useThreadTimelineController.ts:170`) keeps rows in local `useState` inside the controller created at `ThreadDetailView.tsx:888`.
- The controller exposes `hasOlderTimelineRows` (L169, derived from `olderCursor`).
- Phase 2 also exposes the server's `timelinePage.hasOlderRows` through it, and passes the rows and the loader to Artifacts. It does not create a second controller.

**Completed turns are split into segments** (`buildTurnRows`, `build-thread-timeline.ts:1229`; `buildCompletedTurnSummaryRows`, L1185):
- User messages, image generations, and legacy user messages are **ungroupable**. They're always emitted top-level (`isTimelineUngroupableMessage`, `packages/thread-view/src/timeline-message-helpers.ts:19`).
- The **terminal** assistant message (the last `assistant-text` or `error`) is top-level.
- Everything else is folded into **turn segment rows** with `children: null` (L1152) and `summaryCount > 0`. That includes file changes, reads, image views, delegations, and **intermediate assistant messages, with their Markdown links**.
- One turn can produce several segment rows (`segmentIndex`, row id `…:turn:<n>`).
- With `completedTurnDisplay: "flat"`, nothing is folded; the duration row has `summaryCount: 0` (`withFlatTurnDurationRow`, L1156-1183).

**Turn details.** A segment's hidden rows come from `timelineTurnSummaryDetails`, keyed by `(turnId, sourceSeqStart, sourceSeqEnd)`. Two constraints:
- The existing `useThreadTimelineTurnSummaryDetails` queryFn **loops over all pages** (`thread-queries.ts:973-1010`).
- Its `HEAVY_PAYLOAD_QUERY_POLICY` has `gcTime: 60_000` (`apps/app/src/hooks/queries/query-policies.ts:52-56`).

So Artifacts calls `sdk.threads.timelineTurnSummaryDetails` **one page per step** with progress, and **does not rely on the query cache**. Occurrences and the set of checked segments live in Artifacts state, keyed by `threadId`.

**Context clear.** The server only serves rows after the latest completed context clear (`contextBoundarySeq`, `apps/server/src/services/threads/timeline.ts:1313`). Earlier history can't be reached through timeline pagination.

**Raw events.** `GET /threads/:id/events` exists (`apps/server/src/routes/threads/data.ts:608`) and can filter by type. Artifacts doesn't use it: it would mean client-side re-projection that duplicates `thread-view` and bypasses the projection's status mapping.

### 3.2 When is history complete?

Complete only when **all** of these hold:
1. `hasOlderRows === false` (the server flag, via the controller);
2. `contextBoundarySeq === null`;
3. every segment row with `summaryCount > 0` has a fully paged detail result held in Artifacts state, keyed `(turnId, sourceSeqStart, sourceSeqEnd)`.

Count **distinct `turnId`**, not segment rows. Never show "N of M": M is unknown while older pages remain.

Copy:
- Partial: "Checked 18 turns so far. Earlier turns may contain more files." with a **Check earlier** button.
- Context clear: "History before the context was cleared isn't available here."
- Complete: "Checked every turn in this thread."
- Loading: "Checking earlier turns…"

**Check earlier** is user-triggered and never loops automatically. Each click:
1. fetches the next detail page for unchecked segments, one page per step, concurrency 1–2, with progress;
2. once every loaded segment is checked, calls `loadOlderTimelineRows` for one more timeline page.

It repeats only on the next click.

### 3.3 No rescans

- Occurrences are derived per source row and memoized by row object identity (`WeakMap<TimelineRow, Occurrence[]>`). `applyTimelineDelta` reuses unchanged row objects, so a changed row is re-derived alone.
- Detail pages are derived once, when they arrive.
- All state resets when `threadId` changes. Async results whose `threadId` isn't the active one are dropped.

## 4. Source jumps

**Mechanism.** `navigate(threadRoute, { state: { searchMessageSeq, searchThreadId } })`. Today's producer is `CommandPalette.tsx:264`; the reader is `readSearchMessageTarget` (`useScrollToSearchedMessage.ts:158`). A mismatched `searchThreadId` is ignored (L215).

**Jumps are event-level.** Several `file-change` rows from one provider item share `sourceSeqStart..End`, and `findDeepestSeqAnchoredRow` (L54) returns the **first** row containing the seq. So a jump lands on the event, not necessarily on the specific change. Two ways forward:
- accept it, and label the button "Jump to event"; or
- add `searchRowId` to the location state, so the hook prefers an exact row id. That's a small, additive change to the hook. **Recommended.**

**Collapsed turns.**
- `collectSearchedMessageAncestorRowIds` (L149), via `useTimelineSearchExpansionRowIds` (`ThreadTimelineRows.tsx:575`), force-expands the segment that contains the seq.
- That mounts `LazyTurnRowBody` (`ThreadTimelineRows.tsx:1340`), which **loads the detail first**; the nested list then reruns the hook and scrolls.
- Artifacts already holds that detail in its own state, but the timeline reads the query cache, which may have expired after 60s. The expansion then triggers a fresh detail fetch before the scroll: correct, just slower.

**Older pages.** If the seq is below the loaded range, the hook calls `onLoadOlderRows` once per window (L235-246). Occurrences only exist for loaded pages, so their seqs are always reachable.

**Nested (delegation) rows.** The hook descends into `childRows`.

## 5. Panel registration and opening

**Fixed view tabs.** `FixedPanelViewTab` is defined at `packages/client-core/src/panel/fixed-panel-tabs-state.ts:199`. The tabs are built in `ThreadDetailView.tsx:574`, wired at L1559, and switched by `handleSecondaryPanelChange` (L1552).

**Adding an `artifacts` kind** touches:
- the zod schema and type;
- the switches at `fixed-panel-tabs-state.ts:680/823/1030`, `secondaryPanelTabState.ts:102/548`, and `useThreadFileTabs.ts:199`;
- `ThreadSecondaryPanel` in `apps/app/src/lib/thread-secondary-panel.ts`;
- a fixed-tab destination like `thread-info-fixed-tab-navigation.ts`.

Persisted panel state must stay backward-compatible.

**Rendering.** A fixed tab's `renderContent` with `contentFillsRegion` (`ThreadSecondaryPanel.tsx:685-686`, L811).

**Mobile.** `CompactSecondaryPanelShelf` wraps the same panel with `renderAsDrawer`, using the `"full"` presentation.

**Openers.** See the §7.3 allow-list. Uploaded attachments have no panel tab kind: opening one opens the dependency-provided scoped content URL in a new tab, and downloading uses `<a download>` on that same URL.

## 6. No immutable per-event file version exists

- `TimelineFileChange = {path, kind, movePath, diff, diffStats}`: no hash, no blob id. The domain `fileChange` has the same fields (`packages/domain/src/provider-event.ts:123`).
- `FilePreview` (`packages/client-core/src/file-preview.ts:56`) has no version field. Workspace preview sources are `working-tree | head | merge-base`, which are git refs, not events.
- Cloud `cloudFile` keeps **one** copy per path under thread storage and overwrites it on each fetch (`apps/server/src/services/cloudroom/teleport-local.ts:195-207`).
- Image generation `result` is retained output: truncated after 7 days and absent from timeline rows (`packages/db/src/retained-event-output.ts`).
- Attachments' `immutable` cache headers and size-mtime ETag don't prove a version.
- The only genuinely historical data is `file-change.diff`, which may be null or truncated. It can be shown as "Change in this event".

So **Open always means the current file**. The copy, borrowed from Option B and always shown in full:

> Opens what's on disk now. It may differ from when the agent wrote it. Each change below shows its own diff.

## 7. External dependency: thread-scoped file resolution (interface only)

**Owner:** the PNG/daemon thread. Per the orchestrator, the 37504fb/8b982e1 baseline is rejected (symlinked storage-root fail-open; a race between the separate check and read). Daemon enforcement is in progress. Artifacts implements none of this.

### 7.1 Interface

The client sends **only** a thread id, the raw path, and the evidence kind. The **server derives every root**: `environment.path`, the thread storage root, and `thread.projectId` for attachments. The client supplies no cwd, no root, no namespace root, and no projectId.

```ts
type EvidenceKind =
  | "file-change" | "file-read" | "image-view" | "image-generation"
  | "markdown-link" | "attachment";

// request
{ threadId: string; rawPath: string; evidenceKind: EvidenceKind; isProjectAttachment: boolean }

// response (identity is stable; access is evaluated at read time)
{
  identity:
    | { owner: "workspace" | "thread-storage" | "cloud-workspace" | "attachment" | "outside"; key: string }
    | { owner: "unresolved" };
  access:
    | { kind: "allowed"; contentUrl: string; previewTab: PreviewTabRequest | null }
    | { kind: "unavailable" }               // missing OR rejected: indistinguishable
    | { kind: "preview-unavailable" };      // e.g. cloud until §7.4 is met
}
```

- `key` is computed server-side from server roots.
- `PreviewTabRequest` is restricted to `workspace-file-preview` and `thread-storage-file-preview`.
- Batching (many paths per call) is expected for the identity pass.

### 7.2 Enforcement requirements on the dependency

1. **Atomic check→read.** Today the daemon calls `realpath` → `stat` → `readFile` as separate steps (`apps/host-daemon/src/command-handlers/file-read.ts:268`, L348/367, L398/409), so a symlink swap between them escapes the root. Requirements:
   - open with `O_NOFOLLOW` on the final component, plus a per-component no-follow walk (or `openat`-style resolution);
   - `fstat` the opened fd and re-check `dev`/`ino` against the verified path;
   - read from that fd.

   Residual risk, stated honestly: hard links inside the root that point outside it aren't caught by path checks.
2. **Symlinked storage root.** Resolve the root itself before the containment check. This fixes the fail-open the reviewers found.
3. **Attachments.** The same atomic read applies to `readAttachment`, whose containment check is the lexical `resolveContainedPath` with a `stat`/`readFile` gap.
4. **Proof that validation ran** for a user attachment send (§1.3 rule 6), so "Uploaded to this project" can be claimed. Cloud sends currently skip validation.
5. **No existence oracle.** Rejected and missing both return `unavailable`, with the same message and timing class, for preview and download alike.
6. **Side-effect-free cloud read** (§7.4).

### 7.3 What Phase 2 may import (allow-list)

**Allowed:**
- Types from `@cloudroom/server-contract` (`TimelineRow` and friends).
- The row `attachments` shape that `parsePromptInput` produces.
- `useThreadTimelineController` (extended), `sdk.threads.timelineTurnSummaryDetails`, and the location-state contract of `useScrollToSearchedMessage`.
- `parseLocalFileHref` / `resolveRelativeLocalFileHref`, **only for href syntax normalization**:
  - for absolute hrefs, with `absoluteLinks: { kind: "contained", rootPath: "/" }`, just to strip `file://` and line suffixes;
  - relative hrefs are never joined client-side; the raw href goes to the dependency.
- `useThreadFileTabs().openTab`, with **only** the `workspace-file-preview` / `thread-storage-file-preview` requests returned by the dependency.
- `SecondaryPanelFilePreview` / `FilePreview` for rendering.

**Forbidden in the Artifacts import graph:**
- `resolveTimelineImagePreviewTarget`, `resolveTimelineImagePreviewRootPath`, and `resolveThreadLocalFileLink` (`apps/app/src/lib/thread-local-file-links.ts`).
- `openHostFile`. It opens a `host-file-preview` tab backed by `hostFileContent` (`apps/server/src/routes/threads/data.ts:810`):
  - its local branch reads `query.path` with **no root** (L837), so it's an arbitrary host read;
  - its cloud branch writes (§7.4).
- `buildMarkdownMessageLinkRouting` and any `{ kind: "trusted-host" }` routing.
- `openOnMac` / `copyToMac` (`apps/server/src/services/cloudroom/teleport-local.ts:179`).
- `buildThreadHostFileContentUrl`.

Phase 2 adds an import-graph test asserting that none of these are reachable from the Artifacts module.

### 7.4 Cloud reads mutate and can be stale

`cloudFile` (`teleport-local.ts:195-207`) has two problems:
- it **writes** every fetched file into the thread's storage, under `Cloud files/<abs path>`;
- on any error other than `cloud_file_missing`, it **returns the previously saved copy**.

That breaks both "read-only, no mutation" and "current". **Requirement:** a side-effect-free cloud read that returns fresh content or an explicit `stale`/`unavailable` marker.

Until then, cloud-owned items show **"Preview unavailable"** with no open or download. Their history and jumps still work.

### 7.5 No existence oracle (UI side)

- For a path whose identity owner is in scope, the UI never distinguishes "missing" from "rejected". Both read "Not available now".
- "Outside scope" is shown only when the **identity** owner is `outside`. That's a lexical classification of the historical path against server roots, made before any file-system access, so it reveals nothing about whether the file exists.
- "Not verified" means `owner: "unresolved"`, or that the dependency isn't available yet.

## 8. Markdown links

- **Syntax.** Parse with mdast: `link`, `image`, `definition` + `linkReference` nodes, plus GFM autolinks. Only these node types count.
  - Inline `code` spans are **excluded**, even though `markdown-preview.tsx:794` links some inline-code filenames: a code span is not an authored link.
  - Text that merely looks like a path is never a link.
- **Normalization.** Strip `file://` and line suffixes with `parseLocalFileHref` (contained, root `/`). Relative hrefs go raw to the dependency with `evidenceKind: "markdown-link"`.
- **Rows scanned:**
  - every `role === "assistant"` row, including intermediate ones, which only appear once turn details load (§3.1);
  - `role === "user"` rows with `initiator === "user"` and `senderThreadId === null`. Agent-to-agent messages are excluded.
- **Dependency decision:** add `mdast-util-from-markdown` + `mdast-util-gfm` / `micromark-extension-gfm` as direct app deps. They're already transitive in the lockfile via `react-markdown`.

## 9. Open decisions

1. Add the mdast deps? Recommend yes.
2. Attachment display name: the stored basename (recommended), a display-only suffix strip, or a contract change that carries `name`?
3. Count command `activityIntents` reads? Recommend **no**.
4. Add `searchRowId` to the jump location state? Recommend yes.
