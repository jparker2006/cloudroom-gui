# Artifacts tab: design options (Phase 1d)

Option C (chronological feed) stays **dropped**: it groups by event, not by file.

Options A and B are both rendered inside the real `ThreadSecondaryPanel` chrome (Info / Diff / **Artifacts**), using the app's components and tokens. The mock source is `stories/ArtifactsOptions.stories.tsx` (throwaway). Mobile renders use touch emulation (`pointer: coarse`).

## Mock data

Every listed file qualifies through successful evidence (`discovery.md` §1.1). Failed-only files aren't artifacts (D-d).

- `hero-banner.png`: generated, then viewed.
- `ThreadArtifacts.tsx`: created and edited, including inside a subagent. Its failed and denied edits appear only as occurrences.
- Two `README.md` files: workspace vs. thread storage. They're never merged, and their accessible names differ.
- `client.ts`: "Moved from src/client.ts".
- `launch-brief…pdf`: **"Attached in your message"** in every default mock. Pre-D3 sends keep that label forever. "Uploaded to this project" appears only in one stage labelled **"POST-D3 ONLY"**, representing a new send whose event stores D3 validation. That stage is illustrative and must not be copied into product tests.
- `old-report.html`: generated, with a historical "Deleted" occurrence. It's **neutral** in the list. "Not available now" appears only in stages labelled "after a failed Open" (D-b).
- `q3-metrics.csv`: outside scope.
- `logo.svg`: not verified: its raw path contains `..`, with no verified realpath (D-a). It cannot be normalized lexically, even though the thread has an environment.
- `summary.json`: cloud, "Preview unavailable".

## Shared behavior (A and B)

**Identity and access**
- The server re-projects one bounded range with existing buffered-text/assistant assembly, runs the shared extractor, and returns opaque occurrence ids, category, seq range, `rowId`, status, identity and labels (D-e). The client builds no selectors and classifies no evidence.
- Grouping uses the returned identity `(owner, key)`. Unresolved occurrences each stay separate (D-a). Absolute path keys remain stable across root changes, but owner classification can change; relative resolution/key can change too. Re-fetch on a root change.
- Markdown hrefs are percent-decoded in the shared extractor only; event paths remain literal. Phase 2 tests `file:///ws/my%20file.md` grouping with event `/ws/my file.md`.
- The list never pre-checks availability (D-b).

**Occurrences**
- Each shows a status glyph: ✓ success, ✗ failed, a ban glyph for denied, a clock for pending.
- Each has a **Jump** button. Its accessible name starts with the visible word ("Jump to "Edit failed" for ThreadArtifacts.tsx in Turn 6"). Jumps are event-level unless `searchRowId` lands.

**Opening files**
- The current-file caveat has its own full-width, wrapping `text-xs` line, never truncated (checked at 390px): "Opens what's on disk now. It may differ from when the agent wrote it. Each change listed here shows its own diff."
- Open and Download are shown before access is checked (`not-checked`) and after a failed click (`unavailable`, allows retry), except for outside, unresolved and cloud-gated items. Each click calls `resolveAccess({threadId, occurrenceId})`; the result drives the row. Outside/unresolved/cloud-gated items never call it. Downloads use scoped `<a download>` only after an allowed result.
- The Deleted detail may offer Open, but its presence proves nothing about current existence. Only an action checks access.
- After a failed open, the row shows the shared text "Not available now. It may have been moved or deleted, or it's outside this thread's files." It's the same text as a scope rejection.
- "Outside scope", "Not verified", and "Preview unavailable" are distinct text statuses. Status notes and coverage lines are `text-xs`. Option A wraps the owner folder without truncation, so the filename truncates first.

**Coverage states** (all rendered in A; context-cleared also in B):
- **Partial:** "Checked 18 turns so far. Earlier turns may contain more files." plus Check earlier.
- **Context cleared:** "History before the context was cleared isn't available here." Never shown as complete.
- **Older history unreachable** (`hasOlderRows` true, cursor null): "Can't load earlier history." with no button.
- **Complete, empty:** "Checked every turn in this thread." with "No files yet".
- **Initial loading** and **fetch error with Retry**.

**Accessibility**
- **Accessible names come from visible text, in visible order (WCAG 2.5.3).** Row buttons carry no `aria-label`, so their name is the row content: name, provenance labels, owner, folder, status note, and "N sources". The two README rows read "README.md Modified Workspace Workspace root 1 source" and "README.md Generated Thread storage notes 1 source". Phase 2 may add `aria-describedby` for occurrence summaries.
- Type filters are `role="group"` with `aria-pressed`.
- The search input keeps the default focus ring.
- Spinners use `motion-reduce:animate-none`.
- Coarse-pointer targets are ≥44px (`max-md:pointer-coarse:min-h-11`).

## Option A: grouped list, inline expandable sources (recommended)

Screens:
- `screens/options/option-a-desktop.png`: default; statuses after a failed Open; loading; fetch error; search + filter; context cleared; POST-D3 upload; history unreachable; empty; no results.
- `screens/options/option-a-mobile.png`
- `screens/options/option-a-mobile-statuses.png`

**Layout.** The whole row header is one `aria-expanded` button. Expanding shows the sources, then the caveat line, then Open current file / Download.

**Mobile.** The same list. Tags wrap under the name, with no second navigation level.

**Tradeoffs.**
- \+ Fewest new patterns; works on mobile without push navigation.
- − Tall when several rows are expanded. Phase 2 should keep one expanded row at a time, or remember the expanded set per thread.

## Option B: list + detail (fallback)

Screens:
- `screens/options/option-b-desktop.png`: split view; statuses after a failed Open; loading; error; cloud detail; neutral deleted detail; context cleared; no results.
- `screens/options/option-b-mobile-list.png`
- `screens/options/option-b-mobile-detail.png`

**Layout.** Two-line list rows:
1. the filename (truncates first) and "N sources" (`shrink-0`);
2. the owner (`shrink-0`), all provenance labels, and status spans (`shrink-0`); the line wraps as needed.

The detail shows the full path, tags, a "Current file" card, and sources. On mobile, the list pushes to the detail with "‹ All artifacts"; focus moves to the detail heading and returns on back.

**Tradeoffs.**
- \+ Densest scan, and the most prominent current-file explanation.
- − Two-level navigation on mobile, and more state (selection, scroll restore).

## Recommendation

**Option A**, using B's current-file wording verbatim.

## Blockers (final integration waits on these)

### Dependency requirements (interface in `discovery.md` §7)

Artifacts owns the D-e server projection/extraction integration; path enforcement requires the PNG/daemon owner.

**D1. Server extraction and opaque occurrence interface (D-b, D-c, D-e).**
- `artifacts.occurrences({threadId, turnRange | cursor})` re-projects a bounded seq range with existing timeline/turn-details, buffered-text and assistant assembly, then runs the shared extractor in `packages/thread-view`. No independent raw-delta parsing or client extraction.
- Returns server-issued opaque ids, category (`file-change | file-read | image-view | image-gen | attachment | md-link | md-image`), seq range, display/jump `rowId`, status, identity `(owner, key, basis)` and labels; membership is decided server-side. See `discovery.md` §7.1.
- Client tracks received turn ranges/pages and deduplicates opaque ids. One bounded page per call (db-load-budget); coverage stays as in §3.
- `resolveAccess({threadId, occurrenceId})` only, on action; server re-verifies evidence every time. No client selectors, paths, roots, cwd, projectId or classification flags. Discovery derives identity without filesystem access; no separate `identify` call.
- Uses the turn-details projection before route-level truncation. Only the timeline route truncates diffs; turn-details (`data.ts:548`) does not. Existing source/byte budgets remain; incomplete assembly keeps coverage partial (§6).

**D2. Identity derivation rule (D-a).**
- Use the raw event path. Absolute paths as-is. Relative paths against the event's recorded cwd (only `commandExecution` has one), otherwise against `environment.path` with `basis: "current-workspace"` (documented drift).
- With no environment: unresolved, with per-occurrence identity, never merged by raw string.
- Collapse `.` and duplicate slashes. Never collapse `..` lexically. Markdown href percent-decoding belongs in the shared extractor; never decode event paths.
- Absolute path keys are stable, but workspace/outside classification can change with `environment.path`. Relative resolution/key can also change. Re-fetch affected ranges on root changes.
- **Accepted:** identity is lexical, so a retargeted symlink can change which file a key names. Access re-verifies on every read, so scope can't be escaped.

**D3. Upload validation marker.**
- "Uploaded to this project" needs `initiator === "user"`, `senderThreadId === null`, `turnRequest.status === "accepted"`, a relative stored path, **and** a server marker that validation ran for that send.
- Cloud skips validation (`apps/server/src/services/threads/queued-messages.ts:215-224`; `apps/server/src/routes/threads/actions.ts:265-269`).
- Persist the marker on the accepted-input event at send time. Never infer it retroactively: pre-D3 sends remain "Attached in your message" forever. Only new validated sends can earn "Uploaded to this project". "Referenced by path" is for absolute paths authored in text/links.

**D4. Side-effect-free, current cloud read.**
- `cloudFile` writes into thread storage and returns a stale copy after errors (`apps/server/src/services/cloudroom/teleport-local.ts:195-207`).
- Until fixed, cloud items show "Preview unavailable".

**D5. Atomic check→read.**
- Today the daemon does `realpath` → `stat` → `readFile` as separate steps (`apps/host-daemon/src/command-handlers/file-read.ts:268`, L348/367, L398/409).
- Required: an `O_NOFOLLOW` open (plus a no-follow component walk), then `fstat` with a dev/ino recheck, then a read from the same fd. Resolve the storage root before containment.
- Residual risk: hard links.
- This also applies to `readAttachment` (lexical `resolveContainedPath`; a `stat`/`readFile` gap).

**D6. No existence oracle.**
- Missing and rejected return the same `unavailable`, with the same message and timing class.
- Downloads use `<a download>` on the scoped content only.

**D7. Thread- and identity-bound content reads.**
- Content must come from an opaque server-issued `contentToken`, or from a thread-scoped route that re-verifies thread + identity on every read.
- Never the generic `GET /projects/:id/files/content?environmentId=` (`apps/server/src/routes/projects.ts:565-588`), which reaches other threads' worktrees in the same project.
- Content requests cannot substitute a different thread id for the one bound to the occurrence/token.
- Never `openHostFile` / `hostFileContent` (`data.ts:810`; no root at L837), trusted-host routing, `resolveThreadLocalFileLink`, `openOnMac` (`teleport-local.ts:179`), or `copyToMac` (L133).
- PNG helpers stay out of the import graph (allow-list in `discovery.md` §7.3).

**D8. Contained Markdown image routing in previews.**
- Previews opened from Artifacts must not route `![](/abs)` through `trusted-host` / `buildThreadHostFileContentUrl`. Today that happens via `buildMarkdownFileImageRouting` with a `threadId` (`apps/app/src/components/secondary-panel/ThreadSecondaryPanelTabContent.tsx:358-361`, L427-433, L566-572; `apps/app/src/components/ui/markdown-file-image-routing.ts:39-51`).
- Separate the absolute-image policy from `threadId` in `buildMarkdownFileImageRouting` (`markdown-file-image-routing.ts:36-51`). Artifacts previews block **all** absolute image sources. Keep the real threadId and relative `resolveRelativeSrc` via `buildThreadWorktreeRawContentUrl` / `buildThreadStorageRawContentUrl`, with D7 read enforcement.
- Never use `threadId: null`: preview wrappers fall back to forbidden `buildProjectFileContentUrl`.
- Phase 2 tests absolute image sources blocked (including in-root) and relative sources still thread-bound, with no project/host fallback.

**D9. Pagination invariant.**
- Required: `hasOlderRows === true ⇒ olderCursor !== null`. Today the empty-selection branch can return `hasOlderRows: true` with a null cursor (`apps/server/src/services/threads/timeline-pagination.ts:155-163`).
- If it's violated, the UI shows "Can't load earlier history." with no button (rendered in A).

### Decisions still open

1. **Markdown parser deps.** The shared extractor runs on the server after existing message assembly (D-e), and lives in `packages/thread-view`.
   - `remark-gfm` is a direct app dep (`apps/app/package.json:85`) but is only a plugin. Parsing still needs a parser.
   - Recommend adding `mdast-util-from-markdown@2.0.2` + `mdast-util-gfm@3.1.0` + `micromark-extension-gfm@3.0.0` to `packages/thread-view`. All are already locked.
   - The alternative is `unified@11.0.5` + `remark-parse@11.0.0` + `remark-gfm`.
2. **Attachment display name:** stored basename (recommended), a display-only suffix strip, or a contract change carrying `name`.
3. **Command `activityIntents` reads:** recommendation stays **no**.
4. **`searchRowId`** in jump state for exact change rows: recommend yes.
5. **Reviewer choice of option:** A is recommended.

### Not a blocker, but affects completeness

History before the latest context clear isn't served by the timeline API. The tab always says so when `contextBoundarySeq !== null`, and never claims completeness.

## Phase 1d render pass

Re-rendered A desktop, A mobile, A mobile statuses, B desktop and B mobile list for changed labels, wrapping, coverage typography and post-click actions. B mobile detail is unchanged and retains its Phase 1c render. These are static design mocks; server extraction/access remain proposed contracts, not production implementations.
