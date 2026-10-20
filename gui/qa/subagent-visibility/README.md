# In-thread subagent visibility (read-only V1, Direction B)

Status: Direction B selected by Jake. Wired into the real thread view. Needs independent review on the exact head, signed-in check, and iOS Safari drawer check before rollout.

## Where it lives

- **Header chip**: next to the existing `child`/`side chat` pill in `ThreadDetailHeader`. Shows direct count, `+N` nested, active and attention counts (direct only). Opens the Info tab.
- **Info tab**: a Subagents section in `ThreadMetadataContent`, beside Parent, Forks, Environment and Git status. Same secondary panel (drawer on mobile). No new panel kind.
- The thread's own run status only shows transiently in the timeline tail ("Working…", host notices) inside the scroller, so the chip is not placed there.

## Run the previews

```sh
cd gui/apps/app && pnpm storybook   # Ladle
```

Open `thread / subagents / Info panel`: `Desktop`, `Mobile`, `States`.

## Sources of truth

| Fact | Source | Notes |
| --- | --- | --- |
| Hierarchy | `parentThreadId` from the sidebar navigation cache | Visible, open, non-archived threads. Hidden threads and their subtrees never appear. No `includeHidden`, no new polling. |
| Fallback | `useChildThreads` list query | Direct children only; UI says "nested not loaded", never 0. |
| Status | `runtime.displayStatus`, `hasPendingInteraction`, `activity`, `queuedWork` | Labels are the recorded state (Active, Pending, Error, Idle). Details are hedged. Idle is never "done". |
| Counts | Direct children for status buckets; nested counted separately | No server total, so hidden children cannot leak through arithmetic. |
| Model and effort | Cloud: `GET /cloudroom/threads/:id` (`cloudroom_threads.model`; reasoning = current setting), lazy on card expand, 30s stale, no polling. Local or unknown target: "Not recorded" | Never from `default-execution-options`, titles or provider names. |
| Freshness | `useServerConnectionState()` | When not connected: "Updates paused · showing last known". |

## Known limits

- Archived descendants are not counted; the UI says so.
- Cloud `idle` folds completed, interrupted and unknown; the UI says "outcome not recorded here".
- Effort for cloud threads is the current setting, which may differ from the last run.
