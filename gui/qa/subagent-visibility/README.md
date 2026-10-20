# In-thread subagent visibility: two directions (read-only V1)

Status: design candidates. Not wired into `ThreadDetailView` yet. Awaiting Jake's choice.

## Run the previews

```sh
cd gui/apps/app && pnpm storybook   # Ladle
```

Open `thread / subagents / Directions`. Stories: `A Composer Card Desktop|Mobile|Collapsed`, `A States`, `B Header Chip Panel Desktop|Mobile`, `B States`.

## Code

- `apps/app/src/components/thread/subagents/subagent-model.ts`: pure tree, status words, scoped counts. Shared by both directions.
- `SubagentCards.tsx`: task card (recursive), count line, scope note, empty/error.
- `SubagentDirections.tsx`: A = `SubagentComposerCard`; B = `SubagentHeaderChip` + `SubagentPanelSection`.

## Directions

- **A: Composer stack card.** One-line summary in the prompt stack (same slot and chrome as `ThreadWorkflowCard`, outside the timeline scroller). Expands to a capped, self-scrolling list of task cards. Each card expands to show facts, the thread link, and its own descendants.
- **B: Header chip + side panel.** Compact count chip in the thread header. Opens a Subagents section in the secondary panel (full-height drawer on mobile). Denser rows; same expansion.

## Sources of truth (planned wiring)

| Fact | Source | Notes |
| --- | --- | --- |
| Hierarchy | `parentThreadId` from the sidebar navigation list (`useChildThreads` / `useSidebarNavigationThreadSelection`) | Open, non-archived, visible threads only. No `includeHidden`. Provider `childRef` is never treated as a thread ID. |
| Status | `runtime.displayStatus`, `hasPendingInteraction`, `activity`, `queuedWork` | `idle` is never "done". Host states stay separate. Background tasks are a flag, not "working". |
| Direct total | `GET /threads/:id/child-summary` `nonDeletedChildCount` (one call for the open thread) | Includes archived and hidden; shown only as "N more archived or hidden, not shown". Unavailable stays "unknown". |
| Model and effort | Cloud: cloud thread status (`cloudroom_threads.model`), fetched only when a card expands. Local: no recorded read path today, so "Not recorded" | Never from `defaultExecutionOptions`. |
| Freshness | `useServerConnectionState()` | When not `connected`, shows "Updates paused · last known". |

## Known limits

- Archived descendants under a child are not counted; the UI says so.
- Cloud `idle` folds completed, interrupted and unknown together on the server; the UI says "outcome not recorded here".
- A on phones: the collapsed count line wraps to four lines when every bucket is non-zero.
