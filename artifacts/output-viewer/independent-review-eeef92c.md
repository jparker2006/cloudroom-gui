# Independent delta review: eeef92c

## Finding

**P2 — Repeated prefix splitting stalls late indexed-rail pages.** Location: `gui/apps/app/src/components/thread/timeline/output-search.ts:5`, called per visible row by `gui/apps/app/src/components/thread/timeline/OutputViewer.tsx:324`.

`outputMatchContext` derives each line label using `text.slice(0, start).split("\n").length`. The indexed direction invokes it independently for each of up to 50 visible results. A late page repeatedly splits nearly the entire output into temporary arrays/strings on the UI thread. This is introduced by the delta: previously line counts were accumulated during the forward match scan. Offset storage fixes per-match allocation but moves repeated line-count work into rail rendering. Paging or navigating to a late dense match can block input and rendering.

Independent Chromium reproduction on the frozen final helper, with `text = "hit\n".repeat(250000)` (1,000,000 raw characters), query `hit`, active index 249999: indexing and single-highlight HTML generation took **26ms**; mapping offsets 249950–249999 through `outputMatchContext`, exactly as the current last rail page does, took **1,005ms**. All 50 line labels were correct, 249951 through 250000. A 1,313,999-character / 18,000-line fixture measured 22ms indexing and 56ms for its final 50 contexts. These are helper-path timings before React insertion/layout; they confirm a blocking rail cost within the existing payload envelope, rather than relying on the helper's static worst-case estimate. Luna identified the source-level issue independently; the owner was informed promptly after reproduction.

Smallest correction: count visible line positions in one forward pass, or pre-index newline offsets and use bounded lookups; retain bounded rail excerpts and compact match offsets. No fix was made by this reviewer.

## Verdict

**FAIL**, exact immutable SHA `eeef92ce00fd120b733182d3873684c6a87f1f89`, versus `c31561776b1213b30fbc318090e8bface7992096`, due to the P2 above. No additional correctness or security defect was confirmed. Neither default rollout nor actual iOS Safari readiness is approved.

Prior verdicts are preserved separately: original `63b88bf084754262482ebb83c60931c7a781a4cc` FAIL for rail pagination; `c31561776b1213b30fbc318090e8bface7992096` PASS for its corrective delta with performance limitations. Earlier freeze reports remain preserved; this report applies only to the committed eeef92c contents.

## Typed-array bounds and Unicode

Reviewed `gui/apps/app/src/components/thread/timeline/output-search.ts`, especially capacity allocation, match population, subarray bounds, node traversal and on-demand context.

For nonempty literal queries, each non-overlapping `/giu` match consumes at least one UTF-16 code unit per query code point. Unicode simple case folding does not create multi-character expansions. Therefore `floor(text.length / Array.from(query).length)` is a conservative maximum match count, including supplementary-plane case pairs; empty queries take a separate zero-capacity return path. Actual match ends use `match[0].length`, not the query's UTF-16 length. Starts and ends are indexed consistently, and exposed subarrays end at the actual count. Input text within the existing server payload budget is well inside Uint32 offset bounds. No server/store/retention change is present.

Independent Chromium checks compared exact counts and offsets for empty text/query, no matches, a query longer than the text, Kelvin-sign and long-s case folding, supplementary Deseret upper/lower pairs, emoji, combining sequences, mixed CJK/emoji queries, lone high surrogates, and regex-like literal queries. Counts matched native literal `/giu` behavior, starts/ends were correct UTF-16 offsets, and output text remained unchanged.

The capacity is sized to the maximum possible count, not actual count: subarrays retain that bounded backing allocation even for sparse/no-match short queries. This is an explicit bound, not a claim of zero-allocation search. Two buffers use at most eight bytes times the computed capacity, in addition to the source/rendered text and DOM.

## Rail and dense navigation

Reviewed `OutputViewer.tsx:318` onward: `Array.from(typedSubarray, mapper)` correctly creates React elements instead of using TypedArray.map (which would coerce the returned elements). At most 50 visible rail excerpts are derived; end offsets, row keys, selection state and click targets use the same global match index. The previously fixed visible-page clamp is retained. No excerpt strings are retained for all occurrences.

In a temporary Chromium fixture mounted from the unchanged final candidate component, a 1,005-match indexed search rendered 50 initial rail entries with the correct first excerpt. Shift+Enter realized the final selected match after commit, scrolled it visibly into the scroller (scrollTop 19,741), displayed page range 1001–1005 and lines 1,001–1,005, and kept one active logical match highlight. Enter wrapped to the first selected match and scrolled visibly back to top. The fixture was unmounted afterward; no source/test files were added.

Safe markup behavior is retained: command conversion escapes source XML, tool output is escaped, literal queries are regex-escaped, and highlight contents use textContent. Typed starts/ends retain all fragments of a cross-span match. The existing checked-in ANSI, Unicode and hostile-payload cases remain passing.

Pending navigation is unchanged by this delta. It normally drains in the post-commit layout effect. No ordinary user-reachable stale pending-target race was found in the preceding review or this one. An artificial combined/interrupted commit invalidating an index is still not explicitly regression-tested; unsuccessful pending retries are not independently invalidated by query identity. This is an unproven scheduling test gap, not a finding.

## Independent verification

Read and followed `gui/AGENTS.md` and `gui/docs/CODE_REVIEW.md`. Ran through Turbo from gui:

```sh
pnpm exec turbo run test --filter=@cloudroom/app --concurrency=2 -- --maxWorkers=2 src/components/thread/timeline/OutputViewer.test.tsx src/components/thread/timeline/TimelineRowDetails.output-preview.test.tsx src/components/thread/timeline/TerminalOutputBlock.test.tsx
```

**26 tests passed in three files; five Turbo tasks succeeded.** This includes the new 100,000-match regression asserting Uint32 offsets, 800,000 combined offset bytes, exact last start/end, one mark and bounded on-demand context. Rail shrink, delayed completion/close/reopen, escaping and prior anchor tests also pass. Owner reports 50 broader focused tests passed. Final app build/typecheck was running at the time this report was written; no duplicate full build was started. Previously reported app baseline type errors and scripts baseline workflow/ratchet failures were not independently rerun.

Chromium final helper timing: 100,000 same-character matches, selected last index, exact count 100,000, combined used offset views 800,000 bytes, 100,218 HTML characters, approximately **11ms** in this run. This is a helper-function measurement, not a full UI benchmark. The previous candidate's same-size helper run was approximately 283ms. Timings are environment-specific and do not establish general latency guarantees.

## Remaining limits

Full output remains rendered in the DOM. Source parsing/serialization, text-node traversal, output insertion/layout and on-demand line counting still cost work on the UI thread. `outputMatchContext` scans text for the visible rail entries rather than indexing every line once. The per-match object/excerpt allocation and dense per-match newline scan from the previous version are removed; broad performance clearance is still not claimed.

Owner's most recent sparse huge-query evidence was on c315617: 18,000 ANSI lines / 1,314,429 raw characters, 86 exact matches, bounded 360,121px scroller, long tasks around 1,091ms and 438ms. That is evidence for residual caution, not a measurement of the final typed-array candidate. No final huge sparse timing was independently collected here. Earlier harness IPC timeouts are not alone treated as app failures.

No actual iOS Safari was available. Prior desktop/touch Chromium screenshots and focus/scroll/layout checks do not prove native keyboard, visual viewport, safe-area, touch-selection or VoiceOver behavior. Paired-Mac preview forwarding was reported pending/disconnected. Direction A remains the more readable mobile starting point; no direction was made the rollout default.

## Reviewer and helper provenance

Independent reviewer actual current turn_context: **gpt-6.1-sol / medium**, turn `01a15814-6013-7850-b3e6-7035f9bd67f8`; room-cli self-update returned medium. Same scoped read-only helper `cr_child_23eb184ce9d7875c352f6ce6` was reused through room-cli, originally spawned with provider codex, model gpt-6-luna, reasoning high, service-tier default, shared sandbox. Actual final helper turn_context was independently read from its own scoped transcript at line 487: **gpt-6-luna / high**, turn `01a15819-30aa-7a23-aa75-2dfcc147d709`. Effective service tier is absent from turn_context; default was requested but is not runtime-verified. No Claude was used.

Helper raw verdict **FAIL**, P2 repeated prefix scans for visible rail entries, is preserved separately in [luna-raw-review-eeef92c.md](./luna-raw-review-eeef92c.md). The helper originally raised this as a source-level complexity risk without benchmarking it; this independent review reproduced the exact context-generation path above and adopted the finding. Its report distinguishes parent-reported measurements from its own inspection.

No candidate edits, commits, merges or pushes by this reviewer; only report artifacts were written. Tracked timeline files matched eeef92c during the independent tests and Chromium reproduction. Later owner edits appeared in OutputViewer.tsx, output-search.ts and OutputViewer.test.tsx after the finding was communicated. Those edits are outside this frozen verdict; line references refer to git show eeef92c, not the evolving working tree.
