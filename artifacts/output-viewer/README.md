# Output viewer design review

Frozen source: `a28e5664b75113445351e9f6654e8bd707ceb95f` on `design/output-viewer-directions`.

**Recommendation: A, Focused reader.** It leaves more room for reading on phones and has fewer controls. B adds an index of matching lines, useful for investigation, but its rail takes 112px of mobile reading width. Both use the same loaded output, search, rendering and drawer implementation. Neither is the production default. No push, merge, upstream publication or Mac execution occurred.

| Direction | Desktop, 1440×1000 | Touch Chromium, 390×844 |
| --- | --- | --- |
| A: Focused reader | [Screenshot](./a-desktop.png) | [Screenshot](./a-mobile.png) |
| B: Match index | [Screenshot](./b-desktop.png) | [Screenshot](./b-mobile.png) |

## Runnable previews

The cloud Ladle server is running on IPv4 loopback port 6100. Cloudroom forwarding is **pending: paired Mac disconnected**; there is no verified user-facing preview URL. This uses no public hosting. Reconnect the paired Mac and run `room-cli preview status 6100`; use only the returned ready URL.

To run the same code from a checkout:

```sh
cd gui
pnpm install --frozen-lockfile
pnpm exec turbo run storybook --filter=@cloudroom/app -- --host 127.0.0.1 --port 6100
```

Append these paths to the server URL printed by Ladle:

```text
/?story=thread--output-viewer-candidates--focused-reader&mode=preview
/?story=thread--output-viewer-candidates--match-index&mode=preview
```

Open the expanded command's **Open output** button. The scenario selector includes ANSI + Unicode, 18,000 lines / 1,314,429 raw UTF-16 characters, a 52,551-character very long Unicode line, streaming, delayed hydration, response-limited preview, expired retention, failed hydration and nested tool identity. Stream, complete and recovery controls are explicit fixture controls. These are simulated SDK responses through the actual production hydration hook and query cache; they are not live provider execution. The story restores its SDK override on unmount.

## Data, search and interaction boundaries

- `TimelineRowDetails` opts into the candidate only when its optional direction prop is supplied. The stories are the only non-test caller supplying it. Default product entry points remain unchanged.
- Reuses `TerminalOutputBlock`, `ToolCallDetailBlock`, `useTimelineWorkRowFullOutput`, the existing turn-detail query/cache, and `PersistentResponsiveDrawerShell`. There is no additional raw output store, endpoint, server search or new pagination capability. Existing detail retrieval, retention, response limits and retry/query behavior remain in place.
- Candidate hydration is enabled on explicit drawer demand after completion. Pending work keeps its received output. Completion while open enables the existing query. Identity matching includes thread, work kind, call id, turn id and both source bounds; nested delegations are traversed.
- Raw output stays unchanged. XML-escaped ANSI rendering and plain escaped tool rendering produce a separate display/search index. Search is literal, Unicode-aware and case insensitive. Commands, source metadata and arguments are excluded. Synthetic omission notices are searchable only when they are part of the actually loaded preview; they disappear with hydration.
- Coverage text distinguishes streaming so far, streaming preview, loading, complete available output, response-limited preview, expired retention, missing detail reference and load failure. Omitted middle content is never searchable until loaded. Discarded output has no recovery promise. Failed hydration stays visible with the existing retry action; reopening follows existing query enable behavior.
- Next/previous wrap, Enter/Shift+Enter work from search, counts specify loaded output, and the output region is keyboard focusable. Above 1,000 matches, all occurrences remain counted/indexed, while highlighting follows the active match. This bounds highlight markup without discarding output or limiting search coverage. Starts/ends use compact typed offsets; at most 50 rail contexts are derived in one forward scan. The rail's local pages are presentation of loaded matches, not server pages.
- Reading starts held. Wheel, touch, keyboard scrolling and search pause following. **Follow live** is explicit. Prefix/suffix position mapping preserves unchanged head/tail content through append/hydration, including repeated lines and horizontal offsets. If content itself is replaced with no shared anchor, the pixel offset is retained/clamped; discarded text cannot be retained as a visible anchor. Navigation scrolls only the output region. The shared drawer restores trigger focus.

## Verification

| Check | Result |
| --- | --- |
| Focused Turbo viewer/hydration/terminal/drawer tests | **51 passed**, four files; [raw log](./logs/focused-tests.log) |
| App/server/desktop build | **Passed**, 51 Turbo tasks at initial candidate; [raw log](./logs/app-server-desktop-build.log) |
| Final app build | **Passed** after final source change; [combined build/typecheck log](./logs/final-app-build-typecheck.log) |
| Server and desktop typecheck | **Passed**; [raw log](./logs/app-server-desktop-typecheck.log) |
| App typecheck | **Fails**: missing `onNewUrl` in `Automations.stories.tsx`, plus two Ladle dependency typing errors. No error points into viewer changes. Not claimed green. |
| Required config tests | **113 passed**; [raw log](./logs/required-config-scripts-tests.log) |
| Required scripts tests | **128 passed, 5 failed** in workflow-fixture / provider-literal-ratchet checks; exact errors preserved in the same log. Not fixed or claimed green. |
| Real browser QA | Desktop and mobile/touch cloud Chromium. [Recorded observations](./browser-observations.jsonl) include SHA per observation. |
| Actual iOS Safari | **Unavailable / not verified**. No Mac execution was used. |

Tests cover hostile markup/query literals, ANSI-spanning matches, Unicode, exact loaded scope, nested and repeated call identities, demand gating/completion, delayed resolution after close/reopen, unavailable/expired/limited/error states, dense match navigation, rail shrink during hydration, keyboard navigation, stream/touch pause and duplicate-line/hydration anchors. Geometry tests use stubbed metrics; real browser observations supplement them.

Browser observations include loaded scope moving from zero middle-content matches to one after hydration without an automatic scroll; expired retention with zero requests and no retry; correct child tool output; streaming search position held at 5640px while height/count grew; explicit following and wheel pause; output-only touch scrolling and restored trigger focus; horizontal navigation across a 307,349px line without document overflow. The A/B comparison screenshots were recaptured for the frozen source. Supplemental scenario captures/observations made earlier retain their actual candidate provenance; they are not represented as final-SHA retests.

## Raw review history

The independent Sol 6.1 Medium reviewer used a scoped Luna 6 High helper. Their judgments are preserved separately, including disagreements; a primary delta PASS does not replace a helper FAIL.

| Candidate | Primary raw verdict | Helper raw verdict | Resolution |
| --- | --- | --- | --- |
| `63b88bf` | [FAIL](./independent-review-63b88bf.md) | [FAIL](./luna-raw-review-63b88bf.md) | Rail page clamped after hydration; regression added. |
| `c315617` | [PASS for corrective delta, with limits](./independent-review-c315617.md) | [Initial FAIL](./luna-raw-review-c315617-initial-fail.md), corrected to [PASS with residual risks](./luna-raw-review-c315617.md) | Scope classification corrected; owner also replaced per-match object/excerpt allocation with compact offsets. |
| `eeef92c` | [Initial PASS](./independent-review-eeef92c-initial-pass.md), then [FAIL after reproduction](./independent-review-eeef92c.md) | [FAIL](./luna-raw-review-eeef92c.md) | Repeated visible-result prefix scans measured and replaced with one forward scan. |
| `a28e566` | [PASS for prototype comparison](./independent-review-a28e566.md) | [PASS](./luna-raw-review-a28e566.md) | Exact final source; no rollout clearance implied. |

## Settings, coordination and limits

[Runtime evidence](./model-settings.json) verifies owner `gpt-6.1-sol/high`, scoped helpers `gpt-6-luna/high`, independent reviewer `gpt-6.1-sol/medium`, and independent helper `gpt-6-luna/high` from their actual turn contexts. No Claude model was used. **Effective Fast/default service tiers are not exposed in runtime metadata. Owner Fast verification/configuration is unavailable through this cloud room-cli; Fast is not claimed verified.** Requested helper/default tiers were accepted as CLI arguments, not independently verified as effective tiers.

Hydration and drawer/timeline-spacing work had explicit file ownership. The drawer/spacing helper audited the existing persistent shell, focus, keyboard inset and safe areas; no shared drawer, row-list gap, windowing spacing or execution code was edited. No separate timeline/spacing owner registry was found in the repo, so coordination did not include unidentified external owners or unrelated threads.

Full output still has a full DOM representation. Large ANSI output can cause noticeable parse/layout work and accessibility-tree inspection can exceed the browser harness's five-second IPC timeout. Earlier 18,000-line sparse searches produced roughly one-second browser long tasks. Compact dense indexing removes the confirmed allocation issue but does not establish broad device performance readiness. Cloud Chromium also retained missing-glyph boxes for some CJK/emoji text during captures; raw Unicode and search offsets were verified, not native font/IME/VoiceOver behavior. Actual iOS Safari keyboard, zoom, visual viewport, selection and safe-area checks remain necessary before rollout.

Stop point: choose **A** or **B**. There is no rollout, publication or merge authorization in this review pack.
