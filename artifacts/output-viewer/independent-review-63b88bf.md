# Independent review — frozen candidate 63b88bf

## Finding

**P2 — Clamp indexed rail pagination when the loaded match set changes.**

Candidate: `63b88bf084754262482ebb83c60931c7a781a4cc` on `design/output-viewer-directions`.

Location: `gui/apps/app/src/components/thread/timeline/OutputViewer.tsx:296–297` (page state at line 67; pager conditional at line 316).

Direction B slices the current matches using independent `railPage` state. Hydration can remove matches in the synthetic preview omission marker. The code clamps `selected` to the new count, but does not clamp the rail page. An invalid page therefore renders no result buttons even while real matches remain. If the count falls to 50 or fewer, the entire Back/More pager disappears, so users cannot recover through the rail's own controls. Query changes or arrow navigation can recover it.

Concrete realistic reproduction: full output is 49 `e` characters followed by 4,951 `x` characters. The normal 2,000-character head / 1,000-character tail preview inserts `…[2,000 characters omitted from preview]`. Search `e`: 53 preview matches (49 real plus four in the marker). Visit page 2 while the detail request is delayed. Hydration removes the marker, leaving 49 matches; stale page 1 slices indices 50–99 and returns no buttons. I executed the candidate search function in Chromium: `{previewMatches:53, loadedMatches:49, page1Preview:3, page1Hydrated:0, hydratedBackButtonRendered:false}`. The state and rendering branches establish the UI failure. Luna independently identified this issue. The owner was informed during review and accepted it for correction after this freeze. Reset or clamp the page against the current match count and add a shrinking-match regression.

## Raw verdict

**FAIL** for exact SHA `63b88bf084754262482ebb83c60931c7a781a4cc` because of the P2 above. This verdict covers two opt-in prototype directions, not production rollout approval. Subsequent edits/new freeze are outside this report. Direction A is the better mobile starting point: the reviewed owner screenshots show B's 112px mobile rail taking substantial reading width. That preference is not a second correctness finding.

No other confirmed security, identity, source-bound, or asynchronous loading defect was found within this review.

## Evidence and scope

- Read `gui/AGENTS.md` and `gui/docs/CODE_REVIEW.md`; reviewed all nine changed files and the relevant drawer, query, projection, and server detail boundaries.
- No rollout default: the new direction prop is optional; the only non-test caller opting in is the prototype story. Existing timeline callers retain their default body path. Shared hook matching changes were inspected because they also affect that default path.
- ANSI/rendering/highlighting: command conversion retains `escapeXML: true` and `stream: false`; tool output is escaped. Query text is regex-escaped and highlights are built with text nodes. Tests cover hostile markup, regex-like queries, Unicode and matches split across ANSI spans. No executable markup path was found.
- Search scope: only the current loaded output buffer is indexed; command, metadata and tool arguments are excluded. Coverage text distinguishes idle, unavailable, streaming preview, loading, detail-limit, retention expiration, error, and loaded/complete states. Synthetic omission markers are part of a loaded preview, and vanish from search on hydration. This state transition is what triggers the reported pagination issue.
- Identity/source bounds: matching requires thread, work kind, call id, turn id and both source bounds, traversing nested turns/delegations. Query identity includes thread/turn/source bounds. The server rebuilds enclosing turn bounds separately from individual work-row projection bounds; no demonstrated false rejection or cross-row hydration was found.
- Expansion/completion: the prototype fetch is enabled only while open and completed. Pending rows retain their current output; completion while open enables retrieval. Response selection uses current identity. No stale-response cross-row result was found. Explicit deferred close/reopen/identity-switch races were not independently browser-tested; this remains a coverage gap.
- Scrolling: static inspection and tests cover prefix/suffix anchor mapping, duplicate lines, appends/hydration, horizontal position, explicit following, and stopping following on wheel/touch/navigation. The anchor test stubs geometry, so it does not prove browser text metrics. Search navigation uses the first fragment of a split ANSI match. Long lines stay in the output scroller; the whole buffer remains rendered.
- Keyboard/touch/focus/drawer: shared persistent shell supplies focus containment/restoration, Escape, inert closed state, drag handle and keyboard inset handling. Search supports Enter/Shift+Enter, visible arrow controls and a focusable output region. Owner browser QA reports 1440×1000 desktop and 390×844 touch layouts for both directions, 14 exact literal matches, output scrollTop 430 with window.scrollY 0, Escape returning focus to Open output, unchanged thread rectangle, and no document width overflow. I inspected the saved A/B mobile screenshots. The owner performed these interactions; they are not represented as my independent interaction runs.

## Verification

Independently ran from `gui/`:

```sh
pnpm exec turbo run test --filter=@cloudroom/app --concurrency=2 -- --maxWorkers=2 src/components/thread/timeline/OutputViewer.test.tsx src/components/thread/timeline/TimelineRowDetails.output-preview.test.tsx src/components/thread/timeline/TerminalOutputBlock.test.tsx
```

Result: **3 files, 22 tests passed**, 5 Turbo tasks successful. These tests ran while HEAD and tracked contents were the frozen candidate, before owner corrections began. No duplicate full build was run.

Owner-provided broader verification: 46 focused tests passed; app/server/desktop build passed; server/desktop typechecks passed; app typecheck has three baseline errors (Automations story missing `onNewUrl` and Ladle types); scripts has five baseline workflow-fixture/ratchet failures; config passed. I did not independently reproduce the baseline failures or assert that this limited test run replaces those checks.

## Performance and platform limits

The owner loaded 1,314,429 raw characters / 18,000 lines, with scrollHeight 360,121 and document width 1,440. Full accessibility-tree inspection and a huge-search key-dispatch call hit the harness's 5-second IPC timeout. A tooling timeout alone does not establish UI failure. The owner subsequently observed an approximately 1,564ms huge-search long task and is investigating/memoizing conversion outside this freeze.

My separate Chromium measurement called the candidate search helper on a single all-`a` line with query `a`: 10,000 matches took 94ms; 50,000 took 641ms; 100,000 took 1,310ms and generated 21,888,890 HTML characters. This measures synchronous search/highlight construction and serialization, before React insertion/layout. It demonstrates expensive dense-match behavior; it is not an end-to-end app responsiveness benchmark. Rail pagination bounds visible rail buttons, not match creation or the rendered output DOM. Large DOM scale, repeated synchronous search work, and real-device memory/latency remain residual risks; no broad performance clearance is claimed.

No actual iOS Safari was available. Touch-emulated cloud Chromium screenshots do not satisfy actual iOS Safari verification from `gui/AGENTS.md`. Native keyboard, safe-area, visual viewport, touch selection and VoiceOver behavior remain unverified. Neither prototype is cleared for default rollout by this review.

## Reviewer/helper provenance

Independent reviewer: **gpt-6.1-sol / medium**. `room-cli thread update --self --reasoning-level medium` returned `{"reasoning":"medium"}`. More importantly, my own active session's actual `turn_context` reports model `gpt-6.1-sol`, effort `medium`, turn `01a1580d-9554-77d2-89ee-671725d83991`. The owner separately verified the active reviewer process PID 14673. No Claude was used.

Requested scoped helper was launched through:

```sh
room-cli thread spawn --parent-self --provider codex --model gpt-6-luna --reasoning-level high --service-tier default --shared-sandbox
```

Helper ID: `cr_child_23eb184ce9d7875c352f6ce6`. Scope: read-only nested identity/source bounds, expansion/completion races, loaded search scope. CLI returned model `gpt-6-luna`. Actual helper runtime was subsequently verified from its own scoped transcript (`rollout-2026-10-20T06-44-28-01a1580d-e538-7e60-965e-e330406c3e54.jsonl`, initial `turn_context` line 8): **gpt-6-luna / high**. The owner also verified active helper PID 15314. This is not based solely on CLI model metadata.

The helper initially incorrectly copied my Sol/medium provenance into its raw report; that mistaken original paragraph remains preserved, followed by the helper's correction and exact transcript evidence. Service tier is absent from both actual turn_context records: `default` was requested for the helper, but effective default/Fast tier cannot be verified from this metadata. Owner gpt-6.1-sol/high was reported verified by the request; it is separate from this independent reviewer's medium effort.

Helper raw verdict: **FAIL** for this exact candidate, P2 indexed rail clamp; no other confirmed scoped finding. Preserved separately in [luna-raw-review-63b88bf.md](./luna-raw-review-63b88bf.md), including its original mistaken runtime paragraph and appended correction.

## Workspace boundary

This reviewer changed no candidate code and made no commit, merge or push. Only review artifacts were written. At initial review HEAD equaled the exact candidate and tracked contents were clean. Owner correction edits appeared later in `OutputViewer.tsx` and `output-search.ts`; those are not this reviewer's edits and are outside the frozen verdict.
