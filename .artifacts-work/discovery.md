# Artifacts tab: discovery (Phase 1d)

Scratch notes. This folder sits at the **repo root** (`.artifacts-work/`). Code paths below are relative to `gui/`. Phase 1d revises `6b97033`; new projection and routing citations were checked against that baseline. The earlier citations refer to unchanged code from base `37504fb`.

Path scoping, identity derivation, and read enforcement are an **external dependency** owned by the PNG/daemon thread (§7). Artifacts does not generalize, copy, or import the PNG helpers, and does not rebase onto that branch.

---

## 1. Evidence: which rows count, and how

Row shapes come from `packages/server-contract/src/thread-timeline.ts`.

### 1.1 Membership rule

A file **is listed** only if at least one occurrence is *qualifying*:

| Evidence | Row (`workKind` line) | Qualifying when | Label it earns |
|---|---|---|---|
| File change, `kind: "add"` | `file-change` (L306) | `status === "completed" && approvalStatus === null` | **Generated** |
| File change, `kind` `"update"` / `null` / unknown | `file-change` | same | **Modified** |
| File change with `movePath` | `file-change` | same | **Modified**, keyed by the new path (§2.3) |
| File change, `kind: "delete"` | `file-change` | same | No label. A qualifying **"Deleted"** occurrence. |
| Image generation | `image-generation` (L356) | `status === "completed" && path !== null && error === null` | **Generated** |
| Image view | `image-view` (L344) | `status === "completed"` | **Referenced** |
| File read | `file-read` (L370) | `status === "completed"` | **Referenced** |
| Markdown link or image in a conversation row | conversation `text` | Used link/image node (§8) | **Referenced** |
| User attachment | user conversation `attachments` (L79) | See §1.3 | **Attached in your message**, or **Uploaded to this project** for new validated sends after D3 |

**Non-qualifying occurrences:**
- failed (`error`), `pending`, `interrupted`, `waiting_for_approval`, or `denied` file changes;
- failed or pending reads, views, and image generations;
- attachments on pending or rejected user rows.

These are shown **only** as occurrences of a file that already qualifies through other evidence.

**Decision (D-d, deliberate).** A file whose only evidence is failed reads or failed/pending writes is **not an artifact** and is not listed. This follows the ticket: "failed/pending writes are not successful outputs". A failed read is not evidence the file exists or was used.

Labels are a union over qualifying occurrences, so a file can be Generated + Modified. Deleted, failed, and pending never become labels.

### 1.2 Deleted vs. "Not available now"

- **"Deleted"** is an occurrence verb. It's history at that point in the thread, not proof the file is gone now.
- The list **never** shows availability before the user acts (D-b). A row with no failed action stays neutral.
- **"Not available now"** appears only after a user action (open, preview, or download) whose `resolveAccess` / read failed. It uses the **same** text as an out-of-scope rejection: "Not available now. It may have been moved or deleted, or it's outside this thread's files."
- The state is remembered for the session on that row only.

### 1.3 Attachments: "Attached in your message"; D3 applies only to new sends

Facts:
- Uploads go through `storeAttachment` (`apps/server/src/services/projects/attachments.ts:150`). The stored name is `<stem>-<Date.now()>-<rand6><ext>` (`buildStoredFilename`, L45), in a **project**-scoped directory.
- `validatePromptAttachmentReferences` only checks relative paths (`shouldValidateProjectAttachmentReference`, L100).
- **Cloud skips validation.** `createQueuedMessageForThread` returns for cloud before validating (`apps/server/src/services/threads/queued-messages.ts:215-224`), and so does the cloud branch of the queued-message edit route (`apps/server/src/routes/threads/actions.ts:265-269`).
- Rows record neither "validation ran" nor the execution target at send time.
- `parsePromptInput` (`packages/thread-view/src/user-message-parsing.ts:20`) drops `name`, `sizeBytes`, and `mimeType`.

Rule. **"Uploaded to this project"** requires **all** of:
1. `role === "user"`
2. `initiator === "user"`
3. `senderThreadId === null`
4. `turnRequest.status === "accepted"`
5. a relative stored path
6. **a server-supplied marker that validation ran for that send** (D3)

Every accepted attachment without the per-send D3 marker reads **"Attached in your message"**. D3 must persist the validation result on the accepted-input event at send time; it is never inferred from today's execution target or a later file check. **Pre-D3 sends keep this label forever**, even after D3 ships. "Referenced by path" is reserved for absolute paths authored in text or Markdown links. Pending or rejected rows count as non-qualifying occurrences. Agent-only attachments never appear, because `parsePromptInput` skips them.

The copy says "to this project", never "to this thread". Attachments are project-scoped and get copied between projects by name (`copyProjectAttachments`).

Per D-c/D-e, attachment-ness is **derived by the server while extracting the source occurrence**. The client never sends an "is attachment" flag.

Attachment reads aren't exempt from D5:
- `resolveAttachmentPath` → `resolveContainedPath` (`attachments.ts:76`) is lexical.
- `readAttachment` does `stat` and then `readFile` as separate steps (L195-213).

### 1.4 Approval rows

A `file-edit` message becomes an `approval` row **only when it has no changes and `approvalStatus !== null`** (`packages/thread-view/src/build-thread-timeline.ts:600`). Otherwise it becomes one `file-change` row per change (row id `…:file-change:<index>`, L622), each carrying `approvalStatus`. Changeless approval rows have no path, so they never contribute.

### 1.5 Excluded on purpose

- `command.activityIntents[type=read]` (`thread-timeline.ts:43`). These are parsed from shell strings. Recommendation: **no**.
- Inline-code filenames. The renderer links some of them (`resolveInlineCodeMarkdownFileHref`, `apps/app/src/components/ui/markdown-preview.tsx:576`, used at L794); Artifacts deliberately excludes them, since a code span is not an authored link.
- `search`, `tool`, `web-fetch`, and `web-search` rows.
- Delegation `childRef`, which points to another thread. A delegation's own `childRows` are included.

## 2. Identity (D-a) and access (D-b) are separate

### 2.1 Server occurrence extraction and action-time access (D-e replaces client extraction)

- **Discovery:** `artifacts.occurrences({threadId, turnRange | cursor})` re-projects one bounded stored seq range on the server using the existing timeline/turn-details projection, including buffered-text backfill and assistant assembly (§6). The shared extractor in `packages/thread-view` runs on those assembled rows. It returns server-issued opaque occurrence ids, category, seq range, display/jump `rowId`, status, identity `(owner, key, basis)`, and labels (§7.1). Identity derivation does no filesystem access (`stat` included); raw event-store paths remain authoritative for structured events (D-a), never the relativized display paths. Raw events are available server-side (`apps/server/src/routes/threads/data.ts:608`).
- **Access:** `resolveAccess({threadId, occurrenceId})` re-verifies the stored evidence on every user action and returns a scoped read target or `unavailable`. The client builds no selectors and classifies no evidence. The server validates thread ownership of the id. No separate client `identify` call remains.

Rejected, outside, and unresolved items keep their identity and history. They're **never merged** with an allowed group.

### 2.2 Path → identity: one rule for every kind (D-a)

The server takes the **raw** event path (the stored provider event, before `relativizeWorkspacePath` at `build-thread-timeline.ts:425`):

1. **Absolute raw path:** used as-is (after normalization, step 4).
2. **Relative raw path:**
   - if the event store records a cwd for that event, resolve against it. Only `commandExecution` has one (`packages/domain/src/provider-event.ts:398`); `fileChange`, `fileRead`, `imageView`, and `imageGeneration` do not;
   - otherwise resolve against the thread's **`environment.path`**, the same root the timeline projection and Markdown routing use (`resolveThreadWorkspaceRoot`, `apps/server/src/services/threads/timeline.ts:112`). Identity then carries **`basis: "current-workspace"`**.

   **Drift:** an absolute normalized path key is stable when `environment.path` changes. Its owner classification (workspace vs. outside) can change because containment is relative to the current root. For relative paths using `basis: "current-workspace"`, both resolution/key and owner can change with that root. Within one discovery snapshot, retain returned identities; on a root change, invalidate and re-fetch affected ranges rather than mixing snapshots. No original root is invented.
3. **No environment:** the path is **unresolved**. Each unresolved occurrence keeps its **own** identity `(threadId, occurrenceId)`. Unresolved occurrences **never merge by raw string**.
4. **Normalization:**
   - collapse `.` segments and duplicate slashes, and drop a trailing `/`;
   - a path containing `..` is **never collapsed lexically**: it goes to the dependency's realpath check, or it's unresolved.
5. Markdown hrefs follow the same rule, after §8's syntax step.

**Accepted limitation (contract 4):** history identity is **lexical**. If a symlink inside the root is retargeted later, the same key can name a different file than at event time. Access re-verifies on each read (D5), so this can't escape scope; it can only make history point at the current target.

### 2.3 Moves

For a `file-change` with `movePath`:
- the group key is the **new** path, and the occurrence verb is "Moved from `<old>`";
- the old path gets a non-qualifying "Moved to `<new>`" occurrence;
- both raw paths are kept.

### 2.4 Image generation

- Completed with a path and no error: **Generated**.
- Failed, interrupted, or pending: a non-qualifying occurrence. It attaches only if `path` is non-null and that path already qualifies; otherwise it's dropped.

### 2.5 Occurrence identity (D-e)

The server issues an **opaque `occurrenceId`**, stable across overlapping pages and repeated extraction of the same stored evidence. It internally binds the thread, source event/use, and projected row; the client neither constructs nor decodes that binding. The client deduplicates by `(threadId, occurrenceId)`, retaining seq range and `rowId` only for display/jumps. Streaming updates replace the same occurrence; the server re-projects buffered and finalized assistant text before extracting, so a raw delta is never treated as a whole message. `resolveAccess` accepts only `{threadId, occurrenceId}` and re-verifies evidence on every call.

## 3. Completeness and pagination

### 3.1 What is loaded

**Latest page.** `fetchThreadTimeline` (`apps/app/src/hooks/queries/thread-queries.ts:892`). Its `timelinePage` (`packages/server-contract/src/api/threads.ts:900`) carries `hasOlderRows` and `olderCursor`.

**Older pages.** `useThreadTimelineController.loadOlderTimelineRows` (`apps/app/src/components/thread/timeline/useThreadTimelineController.ts:170`) keeps rows in local state inside the controller at `apps/app/src/views/thread-detail/ThreadDetailView.tsx:888`. Today it exposes `hasOlderTimelineRows = olderCursor !== null` (L169). Phase 2 also exposes the server's `hasOlderRows`, and shares rows and the loader with Artifacts. It does not create a second controller.

**Completed turns are split into segments** (`buildTurnRows`, `build-thread-timeline.ts:1229`; `buildCompletedTurnSummaryRows`, L1185):
- Always top-level:
  - user messages, image generations, and legacy user messages (ungroupable: `isTimelineUngroupableMessage`, `packages/thread-view/src/timeline-message-helpers.ts:19`);
  - the terminal assistant message.
- Folded into segment rows (`children: null`, `build-thread-timeline.ts:1152`, with `summaryCount > 0`): file changes, reads, views, delegations, and **intermediate assistant messages with their links**.
- `completedTurnDisplay: "flat"` produces a duration row with `summaryCount: 0` and `children: null` (L1180). It isn't folded.

**Turn details.** Fetched per segment, keyed `(turnId, sourceSeqStart, sourceSeqEnd)`:
- The existing `useThreadTimelineTurnSummaryDetails` queryFn loops over all pages (`thread-queries.ts:973-1010`), and its cache uses `gcTime: 60_000` (`apps/app/src/hooks/queries/query-policies.ts:52-56`).
- Artifacts instead calls the new `artifacts.occurrences` endpoint **one bounded range/page per step**, reusing the existing projection and pagination logic on the server. It keeps returned occurrences, received turn ranges, and checked segments in its own state keyed by `threadId`. It does not extract from client rows or call the all-pages details hook for discovery. A range is checked only when its occurrence cursor is exhausted.

**Context clear.** Only rows after the latest completed context clear are served (`contextBoundarySeq`, `apps/server/src/services/threads/timeline.ts:1313`).

### 3.2 Coverage states

**Complete** only when **all** of these hold:
1. `hasOlderRows === false`
2. `contextBoundarySeq === null`
3. every segment with `summaryCount > 0` has fully paged occurrence coverage for its turn/seq range held in Artifacts state; top-level conversation/image ranges also have occurrence coverage (collapsed segments are not the only evidence)

Count distinct `turnId`. Never show "N of M".

Copy:
- **Partial:** "Checked 18 turns so far. Earlier turns may contain more files." plus **Check earlier**.
- **Context cleared:** "History before the context was cleared isn't available here." It is **never** presented as complete. No "checked every turn" wording.
- **Complete:** "Checked every turn in this thread."
- **Checking:** "Checking earlier turns…"
- **Older history unreachable (contract 3):**
  - The server can return `hasOlderRows: true` with `olderCursor: null`. The page-selection branch with no selected segments returns `hasOlderRows: knownHasOlderSegments ?? …` with `olderCursor: null` (`apps/server/src/services/threads/timeline-pagination.ts:155-163`).
  - Required invariant: `hasOlderRows === true ⇒ olderCursor !== null`.
  - If it's violated, the UI shows "Can't load earlier history." with **no** Check earlier button and no retry loop. Coverage stays partial.

**Check earlier** is user-triggered, one step per click: one occurrence range/page for an unchecked segment; when none are left, one `loadOlderTimelineRows` call to discover earlier ranges. The server enforces bounded seq/event/byte budgets and returns a cursor plus the exact received range. Never fan out over turns or loop all pages in a queryFn (db-load-budget).

### 3.3 No rescans

- The client merges server occurrences by opaque id and tracks received `(turnId, sourceSeqStart, sourceSeqEnd)` ranges and page cursors; it never rescans the transcript or classifies rows.
- The server reuses existing projection/cache logic for unchanged ranges. Streaming changes invalidate only affected ranges; extraction sees assembled message text, including prefixes outside a page when needed.
- State resets on `threadId` change. Async results for another thread are dropped. Query cache eviction cannot erase the client's received coverage or occurrence history.

## 4. Source jumps

- **Mechanism:** `navigate(route, { state: { searchMessageSeq, searchThreadId } })`. Producer today: `CommandPalette.tsx:264`. Reader: `readSearchMessageTarget` (`useScrollToSearchedMessage.ts:158`). A thread mismatch is ignored (L215).
- **Jumps are event-level.** Change rows of one item share a seq, and `findDeepestSeqAnchoredRow` (L54) picks the first. Recommend adding `searchRowId` (additive) so the hook prefers the exact row.
- **Collapsed segment:** ancestor expansion (L149, via `ThreadTimelineRows.tsx:575`) mounts `LazyTurnRowBody` (`ThreadTimelineRows.tsx:1340`). That **loads the detail first** (a refetch if the 60s cache expired); then the nested list scrolls.
- **Older pages:** the hook calls `onLoadOlderRows` once per window (L235-246).
- **Delegations:** the hook descends into `childRows`.

## 5. Panel registration and opening

- **Fixed view tabs:** `FixedPanelViewTab` (`packages/client-core/src/panel/fixed-panel-tabs-state.ts:199`), built at `ThreadDetailView.tsx:574`, wired at L1559, switched at L1552.
- **New `artifacts` kind** touches: the schema and type; the switches at `fixed-panel-tabs-state.ts:680/823/1030`, `secondaryPanelTabState.ts:102/548`, and `useThreadFileTabs.ts:199`; `apps/app/src/lib/thread-secondary-panel.ts`; and a fixed-tab destination. Persisted state must stay backward-compatible.
- **Rendering:** fixed-tab `renderContent` + `contentFillsRegion` (`ThreadSecondaryPanel.tsx:685-686`, L811).
- **Mobile:** `CompactSecondaryPanelShelf`, `renderAsDrawer`, `"full"` presentation.
- **Openers:** §7.3.

## 6. No immutable per-event file version exists

- `TimelineFileChange = {path, kind, movePath, diff, diffStats}` has no hash or blob id. The domain matches (`packages/domain/src/provider-event.ts:123`).
- `FilePreview` (`packages/client-core/src/file-preview.ts:56`) has no version. Workspace preview sources are git refs.
- Cloud `cloudFile` keeps one overwritten copy per path (`apps/server/src/services/cloudroom/teleport-local.ts:195-207`).
- Image generation `result` is retained output (`packages/db/src/retained-event-output.ts`).
- Attachment `immutable` headers and the ETag don't prove a version.
- The only genuinely historical file-change data is `file-change.diff`. It can be `null`. **Only the timeline route** applies `truncateTimelineResponseOutputs` (`apps/server/src/services/threads/timeline-output-truncation.ts:39,83`); the **turn-details route does not** (`apps/server/src/routes/threads/data.ts:548-569`). Retained-output/byte budgets in the details service are separate from this route-level diff truncation.
- **D-e projection choice:** the new occurrence endpoint uses the existing **turn-details projection path** (`apps/server/src/services/threads/timeline.ts:1857-1918`, `buildThreadTimelineTurnDetailsFromEvents`), including whole-item rows, parent/turn context, buffered-text backfill (`timeline.ts:859-875`) and assistant assembly in `packages/thread-view/src/assistant-event-projection.ts` / `buffered-text-projection.ts` (called by `build-event-projection.ts`). It extracts before any route-level output truncation; it does **not** apply `truncateTimelineResponseOutputs`. It never parses raw assistant deltas independently or uses a collapsed summary as evidence. Keep the existing bounded event/retained-output byte budgets and page cursors; truncated/incomplete source text must retain partial coverage and be continued before claiming the range checked. Diffs are historical evidence, not immutable file snapshots, and aren't required in the occurrence response.

So **Open always means the current file**:

> Opens what's on disk now. It may differ from when the agent wrote it. Each change listed here shows its own diff.

## 7. External dependency: identity and access (interface only)

**Owner:** the PNG/daemon thread. The 37504fb/8b982e1 baseline is rejected (symlinked storage-root fail-open; check/read race). This section specifies future interfaces only. Artifacts owns server projection/extraction integration (D-e); containment and read enforcement remain external requirements.

### 7.1 Interface (D-b, D-c, D-e)

The client sends only the thread and a turn range or server page cursor for discovery, then `{threadId, occurrenceId}` for access. No client selectors, paths, classification, roots, cwd, projectId, evidence kind, or attachment flags. The server authorizes the thread and derives all evidence and identities.

```ts
type TurnRange = { turnId: string | null; sourceSeqStart: number; sourceSeqEnd: number };
type Occurrence = {
  occurrenceId: string; // opaque, server-issued; stable across overlapping pages
  category: "file-change" | "file-read" | "image-view" | "image-gen" |
    "attachment" | "md-link" | "md-image";
  sourceSeqStart: number;
  sourceSeqEnd: number;
  rowId: string; // display/jumps only; never an access selector
  status: string; // projected status; preserves failed/pending/denied evidence
  identity: {
    owner: "workspace" | "thread-storage" | "cloud-workspace" | "attachment" |
      "outside" | "unresolved";
    key: string;
    basis: "event-absolute" | "event-cwd" | "current-workspace" | "attachment" | "unresolved";
  };
  labels: Array<"Generated" | "Modified" | "Referenced" |
    "Attached in your message" | "Uploaded to this project">;
  qualifies: boolean; // server membership decision (§1); failed evidence stays occurrence-only
};

artifacts.occurrences(request: { threadId: string } & (
  | { turnRange: TurnRange; cursor?: never }
  | { cursor: string; turnRange?: never }
)): Promise<{
  occurrences: Occurrence[];
  receivedRange: TurnRange;
  nextCursor: string | null; // checked only after all bounded pages for the range
}>;

resolveAccess(request: { threadId: string; occurrenceId: string }): Promise<
  | { kind: "allowed"; contentToken: string; previewTab: ScopedPreviewTabRequest | null }
  | { kind: "unavailable" }         // missing OR rejected: indistinguishable (D6)
  | { kind: "preview-unavailable" } // cloud until D4
>;
```

`resolveAccess` re-verifies the stored source evidence and current containment on **every call**, and binds the resulting content read to thread + identity (D7). A cursor is opaque and bound to thread/range; requested ranges are validated server-side. A null `turnId` covers ungrouped top-level evidence within a bounded seq range. One bounded page per call, no filesystem check during discovery. The client retains non-qualifying evidence until it can merge it into a qualifying group; failed-only groups stay hidden.

Client access state starts **`not-checked`**. Open/Download are shown for eligible items in both `not-checked` and post-click `unavailable` states, so a later click can retry. Clicking calls `resolveAccess` first; its result updates the row. For Download, only an allowed result creates/uses `<a download>` with the scoped content URL. **Outside, unresolved, and cloud-gated items have no actions and never call `resolveAccess`.** A historical Deleted occurrence doesn't gate actions and proves neither present existence nor present absence. No `none` state.

### 7.2 Enforcement requirements (see `options.md` Blockers D1–D9)

1. **Atomic check→read (D5).** Today the daemon does `realpath` → `stat` → `readFile` as separate steps (`apps/host-daemon/src/command-handlers/file-read.ts:268`, L348/367, L398/409). Required:
   - `O_NOFOLLOW` open plus a no-follow per-component walk;
   - `fstat` with a dev/ino recheck;
   - read from that fd;
   - resolve the storage root itself before the containment check.

   Residual risk: hard links inside a root.
2. **Thread- and identity-bound content reads (D7).**
   - Content comes from an opaque server-issued `contentToken`, or from a thread-scoped route that re-verifies thread + identity on every read.
   - Never the generic `GET /projects/:id/files/content?environmentId=` route (`apps/server/src/routes/projects.ts:565-588`): it resolves any environment of the project, including other threads' worktrees.
   - A content request cannot substitute a different thread id for the thread bound to the occurrence/token.
3. **Contained Markdown image routing in previews (D8).**
   - Today `WorkspaceFilePreviewTabContent` / `ThreadStorageFilePreviewTabContent` pass `threadId` into `buildMarkdownFileImageRouting` (`apps/app/src/components/secondary-panel/ThreadSecondaryPanelTabContent.tsx:358-361`, L427-433, L566-572).
   - That turns `![](/abs)` into `trusted-host` and `buildThreadHostFileContentUrl` (`apps/app/src/components/ui/markdown-file-image-routing.ts:39-51`).
   - D8 must **separate the absolute-path policy from `threadId`** in `buildMarkdownFileImageRouting` (`markdown-file-image-routing.ts:36-51`): Artifacts previews explicitly block all absolute image sources, even inside the workspace. A contained root policy alone is insufficient if it still permits in-root absolute sources.
   - Keep the real thread binding for relative images: `resolveRelativeSrc` uses `buildThreadWorktreeRawContentUrl` / `buildThreadStorageRawContentUrl`, subject to D7 re-verification. **Never set `threadId: null`** to obtain this policy: the preview wrappers then fall back to forbidden `buildProjectFileContentUrl`.
   - Phase 2 tests absolute sources (inside and outside the root) blocked and relative sources still routed through thread-bound content, with no host/project fallback.
4. **Upload validation marker (D3).**
5. **Side-effect-free cloud read (D4).**
6. **No existence oracle (D6).**

### 7.3 What Phase 2 may import (allow-list)

**Allowed:**
- `@cloudroom/server-contract` types.
- The `parsePromptInput` output shape (via row `attachments`).
- `useThreadTimelineController` (extended).
- The new `sdk.artifacts.occurrences` and `resolveAccess` contracts (§7.1); existing turn-details queries remain for timeline jumps, not client extraction.
- The `useScrollToSearchedMessage` location-state contract.
- `useThreadFileTabs().openTab`, **only** with `ScopedPreviewTabRequest`s from `resolveAccess`.
- `SecondaryPanelFilePreview` / `FilePreview`, with the contained image routing from D8.

**Forbidden** in the Artifacts import graph (Phase 2 adds an import-graph test):
- `resolveTimelineImagePreviewTarget`, `resolveTimelineImagePreviewRootPath`, `resolveThreadLocalFileLink`;
- `parseLocalFileHref`, `resolveRelativeLocalFileHref`, `normalizeAbsoluteFilePath` (D-a: the server normalizes);
- `openHostFile` / `hostFileContent` (`apps/server/src/routes/threads/data.ts:810`; its local branch reads `query.path` with no root, L837);
- `buildMarkdownMessageLinkRouting` and any `trusted-host` routing;
- `buildThreadHostFileContentUrl`;
- `buildProjectFileContentUrl` (D7);
- `openOnMac` (`apps/server/src/services/cloudroom/teleport-local.ts:179`) and `copyToMac` (L133).

### 7.4 Cloud reads mutate and can be stale (D4)

`cloudFile` (`teleport-local.ts:195-207`) writes each fetch into thread storage under `Cloud files/`, and returns the saved copy after non-missing errors. Until a side-effect-free read with a stale/unavailable marker exists, cloud items are **"Preview unavailable"** with no open or download.

### 7.5 No existence oracle (D6)

- Missing and rejected share one result and one text.
- "Outside scope" comes only from no-filesystem server occurrence identity derivation, so it reveals nothing about existence.
- "Not verified" means `unresolved`.

## 8. Markdown extraction

- **Nodes counted** (actual uses only): `link`, `image`, `linkReference`, and `imageReference`.
  - Reference nodes resolve through their matching `definition` (case-insensitive label match, per CommonMark).
  - **Unused definitions are never counted.**
  - GFM autolinks count. Inline `code` is excluded (§1.5).
- **Href handling (D-a):**
  - the **shared extractor on the server** strips `file://` and the line suffix (`#L…`, `:line[:col]`) from Markdown hrefs, percent-decodes the href path once, and passes it to server identity derivation (§2.2). Malformed percent escapes stay unresolved; no `parseLocalFileHref` or `normalizeAbsoluteFilePath`;
  - relative hrefs are decoded once by that same extractor, then resolved on the server per §2.2;
  - **event paths are literal and never percent-decoded**. Phase 2 test: Markdown `file:///ws/my%20file.md` groups with event path `/ws/my file.md`; event `/ws/my%20file.md` stays distinct;
  - schemes other than `file:` are ignored.
- **Rows:**
  - every assembled assistant row from server projection, including intermediate ones hidden by collapsed client turns;
  - user rows with `initiator === "user"` and `senderThreadId === null`.
- **Shared code (D-e):** the pure extractor lives in `packages/thread-view` and runs on server-projected assembled rows only. The client consumes opaque occurrences, never generates ordinals/selectors, and never classifies. Reference-node uses each get their own server-issued id; definitions alone do not.
- **Phase 2 extraction checks:** a Markdown href split across streamed deltas and its finalized text produce the same server occurrence; overlapping range pages deduplicate it; `resolveAccess` rejects an id from another thread and re-verifies edited evidence. These supplement the reference-node and percent-decoding cases above.
- **Dependencies:**
  - `remark-gfm` is already a direct app dep (`apps/app/package.json:85`), but it's only a plugin. Parsing to mdast still needs `unified` + `remark-parse`.
  - Those aren't direct deps anywhere; they're in the lockfile transitively at `unified@11.0.5` and `remark-parse@11.0.0`.
  - Since the extractor must be shared, the deps go in `packages/thread-view`: `unified`, `remark-parse`, `remark-gfm`. The alternative is `mdast-util-from-markdown@2.0.2` + `mdast-util-gfm@3.1.0` + `micromark-extension-gfm@3.0.0`, all locked; that's smaller, with no unified pipeline.
  - **Decision needed.** I recommend the `mdast-util-from-markdown` trio.

## 9. Open decisions

1. Markdown parser deps in `packages/thread-view`: the `mdast-util-from-markdown` trio (recommended) or `unified` + `remark-parse` + `remark-gfm`.
2. Attachment display name: the stored basename (recommended), a display-only suffix strip, or a contract change.
3. Command `activityIntents` reads: **no**.
4. `searchRowId` for exact jumps: yes.
