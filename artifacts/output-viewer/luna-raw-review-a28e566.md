# Raw review: `a28e5664b75113445351e9f6654e8bd707ceb95f`

Compared with `eeef92ce00fd120b733182d3873684c6a87f1f89`. Scope was only the output rail context calculation and its focused test. Read `gui/AGENTS.md` and `gui/docs/CODE_REVIEW.md`. Candidate code was not changed. No tests, builds, commits, or pushes were run.

## Findings

No findings in this delta.

## Evidence

- [output-search.ts](/code/CloudRoom-UI---design-evolution/gui/apps/app/src/components/thread/timeline/output-search.ts:1) now maps the ordered visible start/end offsets in one pass. It begins at line 1 and the first newline; for each start it advances the newline cursor only while the newline is before that start. Thus newline boundaries are counted once as the sorted starts advance, including late pages, and each excerpt remains bounded to the starting line and match end context. With no starts, `Array.from` returns an empty result without scanning; without any newline, the cursor remains `-1` and line 1/excerpt bounds are correct.
- Starts and ends are UTF-16 offsets produced by the same regex match enumeration, and `outputMatchContexts` uses them directly with string `indexOf`/`slice`, which use UTF-16 indexing too. A match containing a newline keeps the established excerpt behavior: the context is the line containing the match start, clipped at that line's newline. The helper is only used with ordered paired match arrays in this change.
- [OutputViewer.tsx](/code/CloudRoom-UI---design-evolution/gui/apps/app/src/components/thread/timeline/OutputViewer.tsx:94) memoizes the contexts for only the visible 50-match page and gates the calculation on indexed direction plus a nonempty query. Dependencies include the source text, offsets, direction, query, and clamped page. Rail rendering consumes that memoized array, so unrelated component renders do not repeat the context pass.
- The added regression in [OutputViewer.test.tsx](/code/CloudRoom-UI---design-evolution/gui/apps/app/src/components/thread/timeline/OutputViewer.test.tsx:97) checks a late 50-result slice from 20,000 ordered Unicode-containing lines and asserts the first and last line numbers and excerpts. Owner reports 51 focused tests pass, including that case. I did not independently run the test suite.

## Runtime and limits

- This review's own transcript is `/home/cloudroom-agent/.codex/sessions/2026/10/20/rollout-2026-10-20T06-44-28-01a1580d-e538-7e60-965e-e330406c3e54.jsonl`; the turn context associated with the scoped prompt reports `gpt-6-luna`, `high`. The turn context exposes no service-tier field, so `default` is unverified. This provenance comes from the transcript, not inherited `CODEX_SESSION_ID`.
- The whole-output DOM parse/render cost remains the explicitly accepted prototype limitation; this narrow delta review does not grant rollout clearance. No iOS Safari review or rollout assessment was performed.

## Verdict

**PASS** for the exact delta `a28e5664b75113445351e9f6654e8bd707ceb95f` against `eeef92ce00fd120b733182d3873684c6a87f1f89`.

## Parent-reported final Chromium confirmation

The parent reports the same 1,000,000-character / 250,000-line late-page fixture: indexing took 36 ms and the final 50 contexts took 6 ms (the prior implementation took 1,005 ms for those contexts). First/last line numbers were 249,951 and 250,000, with the expected `hit` excerpt. Additional reported cases for empty input, newline-start matches, multiline queries, leading/trailing newlines, and repeated same-line Unicode contexts matched prior semantics. These checks were not run by this reviewer; they reinforce the source review. Verdict remains **PASS** for exact SHA `a28e5664b75113445351e9f6654e8bd707ceb95f`.
