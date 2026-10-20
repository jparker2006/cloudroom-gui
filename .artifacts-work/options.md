# Artifacts tab: design options (Phase 1b)

Option C (chronological feed) is **dropped**. Reviewers agreed it groups by event, not by file.

Options A and B are both rendered inside the real `ThreadSecondaryPanel` chrome (Info / Diff / **Artifacts**). They use the app's components and tokens: `Input`, `Button`, `EmptyStatePanel`, `CHROME_SECTION_LABEL_CLASS`, and `Icon`. The mock source is `stories/ArtifactsOptions.stories.tsx` (throwaway). Mobile renders use touch emulation with `pointer: coarse`, so the 44px targets are visible.

## Mock data

Every file in the mocks qualifies through successful evidence (`discovery.md` §1.1):
- `hero-banner.png`: generated, plus a view.
- `ThreadArtifacts.tsx`: created and edited inside a subagent. It also carries a **failed** edit and a **denied** edit, shown as occurrences only.
- Two `README.md` files: workspace vs. thread storage, never merged.
- `client.ts`: "Moved from src/client.ts", keyed by the new path.
- `launch-brief…pdf`: "Uploaded to this project". This shows the state *after* the validation-proof dependency (Blocker D3); until then it would read "Referenced by path".
- `old-report.html`: generated, a historical "Deleted" occurrence, and a current-read **"Not available now"**.
- `q3-metrics.csv`: "Referenced by path", outside scope.
- `logo.svg`: a relative image-view path. **Not verified** (unresolved), with no actions.
- `summary.json`: cloud workspace. **Preview unavailable**.

`deploy.config.json` was removed: it qualified only through failed and pending writes.

## Shared behavior (both options)

**Grouping and history**
- Grouping uses the dependency's history identity `(owner, key)`, or an attachment identity. It never groups by basename.
- Rejected, outside, unresolved, and unavailable items keep their own groups and history.

**Occurrences**
- Each occurrence shows a status glyph: ✓ success, ✗ failed, a **ban glyph for denied**, and a clock for pending. Each has a **Jump** button named by context, for example `Jump to "Edit failed" for ThreadArtifacts.tsx in Turn 6`.
- Jumps are event-level unless `searchRowId` lands (`discovery.md` §4).

**Opening files**
- The current-file caveat has its **own full-width wrapping line**, never truncated (checked at 390px): "Opens what's on disk now. It may differ from when the agent wrote it. Each change listed here shows its own diff." Attachments use "Opens the stored upload as it is now."
- Open and Download appear only when access is `allowed`. Download is `<a download>` on the scoped content URL only.
- Missing and rejected share one text: "Not available now. It may have been moved or deleted, or it's outside this thread's files." This avoids an existence oracle.
- "Outside scope" (identity owner `outside`), "Not verified" (`unresolved`), and "Preview unavailable" (cloud) are three distinct, text-labelled statuses.

**Coverage copy**
- "Checked 18 turns so far. Earlier turns may contain more files." with **Check earlier**. It never shows "N of M".
- Context-clear note: "History before the context was cleared isn't available here."
- Complete: "Checked every turn in this thread."
- Initial loading: "Finding files in this thread…" with a skeleton.
- Fetch error: "Couldn't load this thread's history", with **Retry** (`role="alert"`).

**Accessibility**
- The search input keeps the default focus ring (`focus-visible:ring-0` removed).
- Type filters are `role="group"` with `aria-pressed` toggle buttons.
- All spinners use `motion-reduce:animate-none`.
- Interactive elements get `max-md:pointer-coarse:min-h-11` (44px): rows, chips, Check earlier, Open, Download, Jump, Retry, and Back. The search input is `h-11` on coarse pointers.

## Option A: grouped list with inline expandable sources (recommended)

Screens:
- `screens/options/option-a-desktop.png`: default, statuses, loading, error, search+filter, context cleared, empty, and no results.
- `screens/options/option-a-mobile.png`
- `screens/options/option-a-mobile-statuses.png`

**Layout.** Search, type filter, coverage note, then one row per file. The **whole row header is one button** with `aria-expanded`, labelled "Sources for `<name>`, N source(s)" with correct plurals. It shows icon, name, provenance tags, owner + folder, a status line where relevant, and "N sources". Expanding reveals the occurrence list, then the caveat line, then Open current file / Download.

**Mobile.** The same list in the compact shelf's full presentation. Tags wrap under the name. There's no second navigation level.

**Focus.** Expanding keeps focus on the row button. Jump moves focus to the timeline target; Back/Escape returns to the row.

**Tradeoffs.**
- \+ Fewest new patterns, and everything is visible in one scroll.
- \+ It works on mobile without push navigation.
- − Tall when many rows are expanded. Phase 2 should allow one expanded row at a time, or remember the expanded set per thread.

## Option B: compact list + detail (fallback)

Screens:
- `screens/options/option-b-desktop.png`: split view, statuses, loading, error, cloud detail, deleted/not-available detail, context cleared, and no results.
- `screens/options/option-b-mobile-list.png`
- `screens/options/option-b-mobile-detail.png`

**Layout.** A one-line list (name, owner, first tag, source count, and "Not available now" / "Preview unavailable" text). Desktop splits vertically into list and detail. The detail shows full path, owner, all tags, a "Current file" card with the caveat and actions, and "Sources in this thread".

**Mobile.** The list pushes to the detail, with "‹ All artifacts" to go back. Focus moves to the detail heading and returns to the row on back.

**Tradeoffs.**
- \+ The densest scan, and the most prominent current-file explanation.
- − Two-level navigation on mobile.
- − Names and owners truncate hard at 390px; see the mobile list render.
- − More state to manage (selection, plus scroll restoration).

## Recommendation

**Option A**, with B's current-file wording, which A now uses verbatim.

## Blockers (final integration waits on these)

### Dependency requirements (owned by the PNG/daemon thread; interface in `discovery.md` §7)

**D1. Server-derived scoping interface.**
- Request: `{threadId, rawPath, evidenceKind, isProjectAttachment}`.
- Response: a history identity `(owner, key) | unresolved`, plus access `allowed {contentUrl, previewTab} | unavailable | preview-unavailable`.
- The server derives every root (`environment.path`, thread storage, `thread.projectId`). The client supplies no cwd, roots, namespace, or projectId.

**D2. No host-path open for event paths.**
- Artifacts never uses `openHostFile` / `hostFileContent` (`apps/server/src/routes/threads/data.ts:810`). Its local branch reads `query.path` with no root (L837).
- It also never uses trusted-host Markdown routing, `resolveThreadLocalFileLink`, `openOnMac`/`copyToMac`, or `buildThreadHostFileContentUrl`.
- The PNG helpers stay out of the Artifacts import graph, enforced by a test. The allowed imports are listed in `discovery.md` §7.3.

**D3. Proof of attachment upload.** "Uploaded to this project" needs **all** of:
- `initiator === "user"`, `senderThreadId === null`, and `turnRequest.status === "accepted"`;
- a relative stored path;
- **a server-supplied marker that validation ran for that send**. Cloud skips validation (`apps/server/src/services/threads/queued-messages.ts:215-224`; `apps/server/src/routes/threads/actions.ts:265-269`).

Until then: "Referenced by path". Attachment reads are **not** exempt: `resolveContainedPath` is lexical, and `readAttachment` has a `stat`/`readFile` gap.

**D4. Side-effect-free, current cloud read.**
- `cloudFile` writes every fetch into thread storage under `Cloud files/`.
- It also returns the saved copy after errors (`apps/server/src/services/cloudroom/teleport-local.ts:195-207`).

The dependency must provide a read with no writes and an explicit stale/unavailable marker. Until then, cloud items show **"Preview unavailable"** and have no open or download.

**D5. Atomic check→read.**
- Today the daemon calls `realpath` → `stat` → `readFile` as separate steps (`apps/host-daemon/src/command-handlers/file-read.ts:268`, L348/367, L398/409).
- Required: an `O_NOFOLLOW` open (plus a no-follow per-component walk), then `fstat` with a dev/ino recheck, then a read from that same fd. The storage root itself must be resolved before containment, to fix the symlinked-root fail-open.
- Residual risk: hard links inside a root that point outside it.
- This also applies to attachment reads.

**D6. No existence oracle.** Rejected and missing both return `unavailable`, with the same message and timing class, for preview and download. Downloads only use `<a download>` on the scoped content URL.

### Decisions still open

1. **mdast dependency:** add `mdast-util-from-markdown` + GFM as direct app deps for link extraction. Recommend yes.
2. **Attachment display name:** stored basename (recommended), a display-only suffix strip, or a contract change that carries `name`.
3. **Command `activityIntents` reads:** recommendation stays **no**, since they're inferred from shell strings.
4. **`searchRowId`** in the jump location state for exact change-row jumps. Recommend yes.
5. **Reviewer choice of option.** A is recommended.

### Not a blocker, but affects completeness

History before the latest context clear isn't served by the timeline API. The tab says so whenever `contextBoundarySeq !== null`.
