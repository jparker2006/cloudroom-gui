# Selected Reader implementation — root handoff

Selection source: `morning-selection-20261020/Sentinel_2dd3dfeea4ac81919708ebba123bf6b7`, Jake selects **1 / A Reader**. This resolves the direction gate only. This resume implements that selection on the existing owner branch. It does not grant review, CI, integration, device, accessibility, acceptance, PR/merge or shipping approval.

The final exact commit and tree are supplied in the owner's completion receipt after this document is committed. Review that exact final head. **No historical signoff is reused.**

## Checkpoint reconciliation

- Branch: `design/output-viewer-directions`.
- Resume base HEAD: `61e3e6ad61597ebfbf780a7429896257a716ecd6`.
- Resume base tree: `ff1b236fe8fdcf6f08df502cc9247488e3c7a1e7`.
- Original branch base: `15cc574c8ff29788b7556f7d26bbddf670479b71`.
- Initial working tree was clean. Ordinary `git show`, parent history and `git diff` prove `61e3e6a` is an evidence-only direct child of `a28e566`; the `gui/` source diff is empty. This explains the checkpoint difference, not review coverage for the new head.
- All original A/B stories, historical commits, tags, review verdicts and evidence remain. No reset, discard, queue operation, history deletion, main/upstream sync, replacement actor, or old-helper wake occurred.
- A generated root `.turbo/` cache appeared during the retrospective runner. It is untracked and intentionally preserved outside the candidate. Both detached sensitivity/control worktrees are retained at the paths in their text files. These are test worktrees, not duplicate agents/builders.

## Selected implementation

Changed source files:

- `TimelineRowDetails.tsx`: real command/tool timeline bodies now default to Reader. The explicit indexed override remains for comparison. Removed the superseded automatic-hydration command/tool implementation rather than keeping two product paths.
- `OutputViewer.tsx`: no hidden full/searchable drawer is constructed until the first output open; the persistent drawer remains mounted after use for focus/state continuity. Product chrome no longer says A/B. Inline previews keep load failures, response limits, retention expiry and unavailable details visible.
- `useTimelineWorkRowFullOutput.ts`: demand still controls fetching. Correctly matched existing query-cache output remains available when the drawer closes; failed or unmatched detail responses remain failure states when closed. Pending/expired checks and identity/source bounds remain. No extra output store, retry policy, response limit, retention rule, endpoint or tool execution change.
- `TimelineRowDetails.reader.test.tsx`: six new actual-entry / explicit-view regressions.
- `TimelineRowDetails.output-preview.test.tsx`: migrated UI assertions to explicit output demand and portal-aware loaded scope; hook identity/availability coverage retained.
- `OutputViewer.stories.tsx`: added `SelectedReader`. Reader fixtures exercise the default product entry; both historical comparison directions remain runnable.

Shared drawer implementation, timeline spacing/row-list owners, keyboard shortcut navigation and collapse-all-subthreads work were not edited. No dependency, framework, design-system or aesthetic redesign was introduced. Raw output, escaped ANSI/plain rendering and loaded-only search remain separate.

## Red → green → refactor and retrospective evidence

[Verification manifest](./verification.json) records source hashes and raw log paths.

1. Existing suite: **51 passed on the resume base**. These are retrospective checks of already implemented code, not a fabricated tests-first chronology.
2. New user-path tests were added before production edits: **five failed** for missing real Reader entry, eager hidden drawer, lost failure warning and lost cached output. The first run also exposed a test-harness cleanup mistake (`beforeEach` returned a mock); that was corrected. The initial green attempt was not green and its raw log is retained.
3. An additional unmatched-response/close regression was run before its fix: **five passed, one failed**. After the smallest state-order correction, **all six passed**.
4. Removed the superseded legacy body path and simplified labels: **57 focused tests passed**. Final focused rerun: **57 passed**. Timeline layout/isolation/windowing/presentation: **19 passed**. Existing scroll integration: **two passed**. Total relevant final tests: **78**.
5. Retrospective sensitivity: the exact historical `c315617` rail regression was copied unchanged into two retained detached test worktrees. It **fails on pre-fix `63b88bf` at the blank-rail user assertion** and **passes on control `c315617`**. One selected test ran per worktree; 12 others were skipped. This demonstrates sensitivity of an existing guard and is not claimed as new red-before-fix evidence for this resume or proof that every historical test catches every possible defect.

Required checks were rerun:

- App/server/desktop builds: **pass**; server/desktop typechecks: **pass**.
- App typecheck: **fails**, three diagnostics in the Automations story (`onNewUrl`) and Ladle dependency types. No viewer diagnostic. The same diagnostic paths appear in earlier evidence; this run is not claimed green.
- Config: **113 pass**. Scripts: **128 pass, five fail** in workflow-fixture and provider-literal-ratchet checks. Exact errors are retained, not fixed as unrelated work.
- No CI result is inferred from local tests. Exact-final-head independent review is pending root; no reviewer was woken or spawned.

## Public guidance and runtime evidence

[Public preflight](./preflight.json) contains public read/tool evidence and hashes. The Cloud skill catalog and a bounded filename search of public skill directories exposed **no applicable product-UI frontend skill** named tasteskill, design-taste-frontend or impeccable. No installation was attempted. `tasteskill v2` is not verified. A Mac skill/version claim does not establish Cloud availability or historical use.

Used existing product guidance: `gui/AGENTS.md`, `app.css`, `components/ui/theme.css` and the existing persistent responsive drawer implementation. Shared branding, typography/theme tokens, focus restoration, keyboard inset and safe-area patterns remain.

Public skills read in this resume, with exact declared names/headings:

| SKILL.md path | Declared name / heading | Declared version |
| --- | --- | --- |
| `/home/cloudroom-agent/.agents/skills/room-cli/SKILL.md` | `room-cli` / Cloudroom from the cloud | none |
| `/home/cloudroom-agent/.agents/skills/browser-harness/SKILL.md` | `browser-harness` / browser-harness | none |
| `/home/cloudroom-agent/.agents/skills/cloud-preview/SKILL.md` | `cloud-preview` / Cloud preview | none |
| `/home/cloudroom-agent/.agents/skills/cloud-computer-use/SKILL.md` | `cloud-computer-use` / Computer use in a Cloud thread | none |
| `/home/cloudroom-agent/.codex/plugins/cache/openai-curated-remote/cloud-environment/0.1.2/skills/runtime/SKILL.md` | `cloud-environment-runtime`; no H1 declared | none; cache directory is not a version declaration |

The existing runtime is Codex in Cloud. Public room-cli exposes children and next-turn reasoning updates, but not the owner's effective current model/reasoning/tier. **Sol 6.1 High/Fast cannot be freshly verified through the exposed public controls.** No protected raw Codex session/config file was read. Historical runtime artifacts were not used as current settings evidence. All four listed children were sleeping and remained unwoken. No Claude or new actor was introduced.

## Remaining gates and supported-tool blockers

- Fresh browser validation is **blocked**. Default browser-harness could not start Xvfb; public diagnostics show display 99 already active. No stale lock was removed and no old process was stopped.
- One ordinary headless attempt used installed Chromium, its default security settings, a unique task profile and loopback debug port. It failed with **No usable sandbox**. No sandbox/security flags, package install, cleanup retry or access bypass followed. Fresh screenshots, browser touch behavior and actual-device validation are not claimed. Historical comparison screenshots remain historical.
- Actual iOS Safari, native keyboard/visual viewport, device accessibility, signed-in end-to-end integration and acceptance remain open. Whole-output DOM parsing/rendering remains a performance limit; lazy first mounting avoids pre-demand searchable-view work but does not imply broad performance clearance.
- Ladle runs on IPv4 loopback port 6100. Forwarding reports **pending paired Mac**. No user-facing URL is fabricated; no Mac execution, login, credential, account, security or billing change occurred.
- The only attempted controller message was the authorized `room-cli thread tell thr_fg6w93w5pu`; it returned **Not a subagent of this thread**. No alternate control route was attempted. This handoff and the completion receipt are for relay by that sole existing controller.

## Fork and review boundary

Read-only GitHub metadata verified `jparker2006/cloudroom-gui` is Jake's fork of `davidondrej/cloudroom-gui`, with push permission. Origin fetch/push URLs match that fork. Scoped remote branch was absent on the pre-push checks. Only a coherent feature-branch commit and ordinary push to `refs/heads/design/output-viewer-directions` are authorized. If the remote changes or denies access, preserve the checkpoint and report; do not force or bypass.

No PR creation/merge, main/upstream publication/sync or automatic shipping is authorized by selection. Root must reconcile independent review of the final exact head, required CI, integration and all remaining gates.

## Runnable selected preview

From `gui/`:

```sh
pnpm exec turbo run storybook --filter=@cloudroom/app -- --host 127.0.0.1 --port 6100
```

Use the URL Ladle prints, with `/?story=thread--output-viewer-candidates--selected-reader&mode=preview`. The original `focused-reader` and `match-index` comparison story paths remain. The scenario selector still includes ANSI/Unicode, huge output, very long lines, streaming, loading, limited/expired output, failed hydration and nested tools. These are simulated SDK fixtures through the real hook/query cache, not signed-in/live-provider validation.
