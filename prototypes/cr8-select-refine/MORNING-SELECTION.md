# CR8 selected prototype: morning resume

Selection is approved; implementation, review and shipping are separate states. This candidate corrects the existing isolated prototype only. `gui/` remains unchanged. Real device, signed-in access, performance, privacy, source-anchor and exact-final-head independent review gates persist.

## Human direction and source anchors

Relayed by sole controller `thr_fg6w93w5pu`, authorized by Jake:

- `morning-selection-20261020/Sentinel_de612a114a4481919ab9df45330c138e`: “Rec is fine”.
- `morning-selection-20261020/Sentinel_6da1fbd362a88191833b129d1952cb90`: “1”.
- Explicit selection: **desktop1 dock UNDER preview; mobile1 bottom drawer and fix clipping**.

These select the existing A layouts. B artifacts remain historical alternatives and were not redesigned. No framework, theme, design system, sharing system or production bridge was introduced.

## Preflight and scope

Sole-owner branch: `room/cr8-select-and-refine-workflow-fsgq`. Morning base HEAD: `0e346e6b11b2845452feb211bce423654655aff7`; tree: `e1ea7c3097a63864da3afd129bbec5c8ea80c8f9`. Zero dirty files; empty diff SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. All matched the supplied checkpoint before source edits. The original feature base remains v109 `15cc574c8ff29788b7556f7d26bbddf670479b71`; v111 reconciliation remains in RECONCILIATION.md. No upstream/main synchronization occurred.

All six existing children were asleep at preflight. No child/helper/reviewer was awakened, replaced or created. Codex is the active provider in the Cloudroom Linux API runtime; effective model/effort/service-tier metadata is not exposed by the available cloud CLI, so High/Fast is not independently attested. No protected raw Codex session/config files were read.

Changed implementation is limited to `room/app.css`, `room/app.js`, `room/index.html` and `shell/shell.js`. Tests, selected renders and the accompanying documentation are the remaining owned files. No private/unrelated artifact or queue/history entry was deleted or replaced. Tests use the isolated mock API, never real thread queues.

## Exact changed files

All paths below are relative to `prototypes/cr8-select-refine/`:

| Scope | Files |
| --- | --- |
| Runtime | `room/app.css`, `room/app.js`, `room/index.html`, `shell/shell.js` |
| Tests / renderer | `tests/selected-layout.mjs`, `tests/render-designs.mjs` |
| Selected renders | `designs/desktop-A-docked-in-preview.png`, `designs/mobile-A-half-sheet.png`, `designs/mobile-A-sensitive-form.png` |
| Documentation | `README.md`, `FINDINGS.md`, `RECONCILIATION.md`, `REVIEWS.md`, `MORNING-SELECTION.md` |
| Generated-output exclusion | `.gitignore` |

## Public guidance actually inspected

The runtime's available-skill catalog, public `SKILL.md` listings under `/home/cloudroom-agent/.agents/skills`, `/home/cloudroom-agent/.codex/skills` and the installed plugin cache expose no applicable general frontend/product-UI skill. No `tasteskill` or `impeccable` path was found there. Mac availability or a Mac skill version is not Cloud-runtime evidence. No claim of historical use follows from discovery. Sites and theme-authoring guidance target other tasks and were not applied.

| Read public guidance | Declared title/name | Declared version | Applied scope |
| --- | --- | --- | --- |
| `/home/cloudroom-agent/.agents/skills/room-cli/SKILL.md` | `room-cli` | None | Current thread/child scope and controller reporting; no actor starts. |
| `/home/cloudroom-agent/.agents/skills/browser-harness/SKILL.md` | `browser-harness` | None | Browser/tool boundaries; its public `browser-harness skill` guide was also read. Existing Playwright runners supply the regression tests and real image renders. |

Product guidance comes from the actual repository: `gui/AGENTS.md`; `gui/packages/shared-ui/src/components/ui/responsive-overlay.tsx` (persistent drawer, focus return, keyboard handling); `gui/apps/app/src/app.css` (dynamic/standalone shell height); and `gui/apps/app/src/lib/themes/default.ts` (existing theme tokens). The mock keeps its existing Cloudroom styling. A later product implementation must use the real persistent drawer and compact preview shelf; this standalone mock is not that integration.

## Resulting behavior

- Desktop 1 stays docked directly under its preview.
- Mobile 1 has a scrollable body between its target header and action footer. Tools wrap instead of scrolling sideways; source file/line text wraps fully. Short viewports leave enough body height to edit the request while keeping the footer reachable. Dynamic shell height and the existing safe-area variable are used; emulation does not establish native keyboard behavior.
- Unverified source candidates no longer display a verification checkmark. The same file/line candidate remains removable and is still checked only on explicit Send. Queue keeps the verified source anchor in the outgoing mock request.
- Cancel and successful Queue end the picker. Scroll positions changed by reveal, keyboard picking, drag or wheel are recorded locally and restored only for the same document/generation, without applying an old return to a new session or navigation.
- Long conversations stay inside their scroll container. Chat/Preview round trips and same-thread refreshes preserve reading position; readers already at the bottom continue following new content. Composer drafts remain untouched by selection cancellation/Queue.

## Red, green, refactor and sensitivity

1. New user-path tests were added before application fixes. The first usable baseline failed clipping, source visibility/false verification, preview return, picker end and conversation scrolling. Harness-only failures (an ambiguous source locator) were corrected before they were treated as defect evidence. Zero-scroll “passes” were rejected by requiring a genuinely scrollable conversation.
2. The completed early baseline was **9/42** on unchanged application source. Subsequent test corrections removed an unintended preparation scroll and waited for the previous Cancel's return to finish before beginning another scenario. Temporary startup-acknowledgment/debug experiments were removed; the final bridge uses the existing messages.
3. The final test adds a real nested-panel wheel/Cancel path. It failed before its fix (`166 → 86 → 86`) and passes after restoration (`166 → 86 → 166`). The selected candidate reached **43/43** across Chromium phone 390×664, narrow 320×568, short 390×440, WebKit phone and Chromium desktop. These are browser viewport checks, not physical-device/keyboard tests.
4. Refactor: removed the obsolete source-verification CSS decoration. No new abstraction or dependency was added. Renderer filtering confines this resume's regenerated designs to the three selected A artifacts.
5. **Retrospective sensitivity replay:** the exact final selected-layout test is run against an untouched archive of morning base `0e346e6` on separate loopback ports. The final replay reports **10/43** (33 failures), including the tightened focus-outline check; the earlier replay before that check was 11/43. This is a later replay, not invented test-first chronology. It confirms the final checks detect defects in the supplied checkpoint. Source, clipping and return assertions remain intact.
6. The existing 162-check suite is **retrospective regression coverage**, not test-first evidence for the new defects: it passed at the morning base and cannot establish sensitivity to clipping/reading problems by itself. The new failing regressions supply that evidence. The final post-refactor selected runner passes **43/43**. The 162-check retrospective suite is rerun on the frozen implementation; it passes **162/162** on the frozen implementation.

7. Final visual QA found the input focus outline clipped by the new scroll body. A stricter outline-bounds assertion failed **8/9** on Chromium phone before adding a 4px body inset/scroll padding. It now passes in the final 43/43 run. Final selected renders were regenerated and visually inspected after that correction. No test claims physical keyboard or VoiceOver coverage.

Local evidence is retained under `/tmp/cr8-morning/`: final baseline replay results in `frozen-checkpoint-replay/results.json`, final selected candidate results in `frozen/results.json` (earlier green directories preserve intermediate evidence), and the existing suite's results in `retrospective/out/test-results.json`. Logs are `/tmp/cr8-morning-*.log`. Tests do not overwrite the recovered tracked `out/` evidence.

## Final validation

| Run | Pass / total | Result JSON SHA-256 |
| --- | --- | --- |
| Selected workflow, final | 43/43 | `8cb63e222a82c73f49730a0da4dcb0cb88d6735d8bee8423d5e2dd596dc6b227` |
| Final test on untouched morning base (expected red) | 10/43 | `c381941e8888954e712eb65177e7a22640f99dd81c281ef3d8b9424fabde3316` |
| Existing suite, final retrospective coverage | 162/162 | `a650e6b749ad0360ab1025daa015068c589a3938c1a1d10291e4c2ac5048812e` |

JavaScript syntax checks and `git diff --check` pass. All four runtime files are covered by these final browser checks; native selection code and the context extractor did not change. No GUI production build, new native capture run or physical-device/signed-in test is claimed.

## Freeze and remaining gates

Final validation/freeze metadata is reported to the controller with the exact commit/tree/base after completion. Root owns reconciliation of the existing independent exact-final-head review; no old signoff approves this candidate. No PR, merge or shipping follows automatically from selection or passing fixture tests.

Open gates remain: actual iPhone Safari/WKWebView and signed-in relay/auth paths; native keyboard/safe-area and VoiceOver; general malicious-page/opaque-content privacy; full-document phone rendering performance and its 5,000-element cap; real host/share/thread ownership; actual project source resolution/navigation; product drawer integration; and missing full historical reports. Native Electron evidence from the earlier checkpoint is historical, not a new exact-head native run. No install, OS change, capture/security privilege change, simulator, billing/account change or new local builder was used.
