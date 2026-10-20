# Raw delta review: `c31561776b1213b30fbc318090e8bface7992096`

Compared with `63b88bf084754262482ebb83c60931c7a781a4cc`. Read `gui/AGENTS.md` and `gui/docs/CODE_REVIEW.md`. Candidate files were not changed. No tests, builds, commits, or pushes were run.

## Finding

- **P2 — Dense searches still allocate excerpt metadata for every match.** In [output-search.ts](/code/CloudRoom-UI---design-evolution/gui/apps/app/src/components/thread/timeline/output-search.ts:60), the `matchAll` loop appends an `OutputMatch` object with an excerpt for every occurrence. The new `MAX_OUTPUT_HIGHLIGHTS` threshold at line 8 only restricts generated `<mark>` elements; `activeOnly` at lines 77–78 runs after the full `matches` array has already been built. A one-character search over a 1–2 MiB output consisting of that same character therefore creates roughly 1–2 million objects and excerpt strings on the UI thread before showing just one mark. The server’s timeline event-data response budget is 4 MiB (`gui/apps/server/src/services/threads/timeline.ts:174`), so this is within the supported payload envelope. This can cause long input stalls or substantial memory pressure on the dense-result path. Exact total count does not require retaining one excerpt string per occurrence; indexed excerpts can be materialized on demand.

## Requested race and scope checks

- **Pending navigation:** no confirmed reachable user race. `navigate` records the deferred index when the old DOM does not yet have the requested dense-result mark (`OutputViewer.tsx:174–180`). The layout effect retries after commit and clears the ref on a successful scroll (`160–173`). A normal discrete click/Enter update commits and runs layout effects before the next browser event, so typing a new query or receiving a later output update cannot ordinarily intervene between setting the ref and its post-commit retry. If a same-commit or interrupted concurrent update replaces query/output and removes that index, the retry can fail and leave the ref stale because unsuccessful retries do not clear it. I found no evidence that this state transition is reachable through the ordinary user event sequence; the current 25-test report does not specifically exercise that artificial combined-update case.
- **Visible rail clamp:** no confirmed defect. `visibleRailPage` clamps the displayed page to the current count (`OutputViewer.tsx:89–92`), and rail rendering plus Back/More actions consistently use that visible page (`317–355`). The added hydration regression checks a 120-to-3 match reduction and verifies the three remaining rail buttons (`OutputViewer.test.tsx:174–207`). The stored `railPage` is not rewritten on shrink, but query changes reset it and all current rendering/actions derive from the clamp.
- **Dense counting/highlighting safety:** counting all occurrences remains exact. Only one safe mark is rendered above 1,000 matches; mark text is assigned through `textContent` (`output-search.ts:93–98`), while command/tool source HTML remains terminal-converted or escaped (`OutputViewer.tsx:74–83`). Checked-in tests cover 1,005 matches and active navigation (`OutputViewer.test.tsx:157–172`), and the original tests cover escaped literal output and ANSI/Unicode matching (`OutputViewer.test.tsx:94–155`). The unbounded per-match metadata allocation is the finding above.

## Verdict

**FAIL** for exact SHA `c31561776b1213b30fbc318090e8bface7992096`, due to the P2 dense-search allocation finding. The visible rail clamp and ordinary post-commit pending-navigation flow look correct.

## Runtime provenance and verification limits

- This reviewer’s own transcript was located by the current scoped prompt, not by the inherited `CODEX_SESSION_ID`: `/home/cloudroom-agent/.codex/sessions/2026/10/20/rollout-2026-10-20T06-44-28-01a1580d-e538-7e60-965e-e330406c3e54.jsonl`. The matching turn context reports `model: gpt-6-luna`, `effort: high` (turn context at line 312; scoped prompt at line 313). This verifies model and effort. The transcript turn context does not expose service tier, so `default` is unverified.
- Owner-reported evidence: 25 focused tests pass; Chromium helper checks cover 1,000/1,001 thresholds, split-span active highlights, exact counts, and no executable markup. Not rerun here. The owner is running build/typecheck; those were not duplicated.
- No actual iOS Safari review was performed here.
