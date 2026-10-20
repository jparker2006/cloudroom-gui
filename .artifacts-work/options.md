# Artifacts tab: design options (Phase 1)

All three are rendered inside the real `ThreadSecondaryPanel` chrome (tab strip with Info / Diff / **Artifacts**). They use the app's real tokens and components: `Input`, `Button`, `EmptyStatePanel`, launcher row classes, `CHROME_SECTION_LABEL_CLASS`, and `Icon`. The mock source is `stories/ArtifactsOptions.stories.tsx` (throwaway). The same mock data covers all three:
- generated / modified / uploaded / referenced labels
- a repeated file with 4 sources, including a failed edit and a nested subagent edit
- two `README.md` files with different owners (workspace vs. thread storage)
- a missing (deleted) file
- a failed write plus a pending approval with no successful write
- an out-of-scope absolute-path attachment
- a partial-history banner
- search plus type filter, and the empty, no-results, and loading states

Shared rules in every option:
- Grouping is by verified owner + normalized path (or attachment `projectId + storedPath`). Never by basename.
- Every occurrence keeps its status icon (✓ / ✗ failed / clock pending / denied) and a jump action to its source seq.
- "Open" always opens the **current** file, with the copy "may differ from when the agent wrote it".
- Scoping comes from an external resolver (`resolveThreadScopedFile`, see `discovery.md` §7). Artifacts never decides containment itself. Rejected or out-of-scope items keep their history but have no open or download.
- Partial history is always stated with counts. "Check earlier" is user-triggered.

## Option A: grouped list with inline expandable sources
Screens: `screens/options/option-a-desktop.png`, `screens/options/option-a-mobile.png`

- **Layout:** search, type chips, coverage banner, then one row per artifact. Each row shows file icon, name, provenance tags, owner + directory, and a trailing "N sources" or relative time. A chevron expands the sources inline, followed by "Open current file · Download · May differ from when the agent wrote it".
- **Provenance:** tags on the row (multiple allowed, e.g. Generated + Modified). Failed-only files show "No successful write" and get no tag.
- **Occurrences / source jump:** expanded sources list verb, turn, and time; the jump icon navigates via `searchMessageSeq`. "· earlier" marks sources in older pages, and the jump loads them.
- **Current vs. historical:** a one-line caption next to Open. A "View change" action per edit occurrence can open the event's diff (historical).
- **Mobile:** the same list at full width in the compact shelf (full presentation). Rows grow with coarse-pointer sizing. No extra navigation level.
- **A11y:** rows are a list; the chevron is a button with `aria-expanded`; type chips are a `radiogroup`; the banner is `role="status"`; status icons have `aria-label`s; each jump button has a full label ("Edit failed, Turn 6. Jump to source"). Focus stays on the chevron when expanding.
- **Tradeoffs:** + Simplest, and closest to the New-tab launcher, so the fewest new patterns. + Everything is visible in one scroll. − Busy when many rows are expanded; long histories push the list down. − Row secondary lines (owner, dir, note) make rows taller.

## Option B: compact list + detail view
Screens: `screens/options/option-b-desktop.png`, `screens/options/option-b-mobile-list.png`, `screens/options/option-b-mobile-detail.png`

- **Layout:** desktop splits vertically. The top half is a dense one-line list (name, owner, first tag, ×N, warning icon). The bottom half shows the selected file's detail: name, path, owner, all tags, a "Current file" explainer card, Open current / Download, and "Sources in this thread".
- **Provenance:** a compact single tag in the list; the full set in the detail.
- **Occurrences / source jump:** only in the detail, so there's room for nesting context ("Inside Explore subagent") and per-occurrence diff links.
- **Current vs. historical:** a dedicated explainer card in the detail. It's the most explicit of the three.
- **Mobile:** list → push to the detail with "‹ All artifacts". Back restores the list scroll position and focus on the row.
- **A11y:** list rows use `aria-current` for the selection; the detail region is labelled by the file name; moving focus to the detail heading on select is required on mobile.
- **Tradeoffs:** + Cleanest scanning of many files. + The best place for honest current-vs-historical copy. − Two-level navigation on mobile; selection state to preserve. − The split eats vertical space on short panels. − More code (selection plus responsive layout).

## Option C: chronological source feed ("By time" / "By file")
Screens: `screens/options/option-c-desktop.png`, `screens/options/option-c-mobile.png`

- **Layout:** groups by source turn or user message, newest first. Each entry is file + verb + owner + "+N other sources". The group header has a Jump action. A "By file" toggle would fall back to Option A's list.
- **Provenance:** the verb carries it ("Created file", "Edit failed", "Attached by path"). Labels are implicit.
- **Occurrences / source jump:** native, since it's ordered like the transcript. Older pages appear at the bottom with "8 earlier turns not checked yet · Check earlier", which maps directly onto pagination.
- **Current vs. historical:** weakest. The same file appears in several groups, and Open still shows the current file. The caption must repeat.
- **Mobile:** works well as a feed. Dense but readable.
- **A11y:** one `section` per group with `aria-label`; simple.
- **Tradeoffs:** + Matches how pagination and coverage actually work, so partial history is very natural. − Not a "what files exist" view; repeated files are scattered, which clashes with the "group repeated references" requirement unless "By file" is the default. − Two views means more surface.

## Recommendation
**Option A**, with one piece borrowed from B: the per-file "Current file — may differ…" caption sits next to Open in the expanded area (as mocked).

Why A:
- It's a single list using existing launcher patterns.
- It meets every requirement (grouping, all occurrences, status, jumps, partial history, empty and no-results states) with the least new UI and code.
- It works on the compact shelf without a second navigation level.

B is the fallback if reviewers want stronger current-vs-historical messaging or expect very long per-file histories. C is not recommended as the default: it groups by event, not by file.

States covered in the mocks:
- default + partial history
- search + type filter (same basename, different owners)
- no artifacts (complete coverage)
- no search results (with an "only checked turns are searched" note)
- loading earlier turns (B)
- missing file
- out-of-scope reference
- failed write / pending approval

The "unavailable file" preview state reuses `SecondaryPanelFilePreview`'s existing `not-found` view when opened.

## Blockers (final integration waits on these)
1. **Path-scoping enforcement (external).** The PNG strict-scope baseline (37504fb, now 8b982e1 on its own thread) is rejected: symlinked storage-root fail-open, plus a race between the separate check and read. Daemon-side enforcement is being fixed elsewhere. Artifacts needs `resolveThreadScopedFile(threadId, namespace, path, cwd) → allowed {namespace, canonical key, open/download target} | rejected {reason}`, with the read enforced atomically server/daemon-side. Until it lands: preview and download are disabled for event paths (attachments still work through their server-validated route), and items show "Not verified".
2. **Canonical grouping key** comes from that same resolver (realpath-normalized). Without it, grouping uses the exact normalized absolute path under an "unverified" namespace. That's honest but may split symlinked aliases.
3. **Dependency approval:** `mdast-util-from-markdown` (+ GFM extension) as direct app deps for Markdown link extraction.
4. **Contract decision (optional):** keep the attachment original `name` in `timelineConversationAttachmentsSchema` (otherwise we show stored names).
5. **Reviewer choice of option** (A recommended).

Not a blocker, but it affects how complete the tab can be: history before the latest context clear isn't served by the timeline API, so the tab always says so when `contextBoundarySeq !== null`.
