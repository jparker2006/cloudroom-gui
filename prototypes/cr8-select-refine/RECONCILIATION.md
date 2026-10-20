# CR8 bounded resume: v111 reconciliation

Read-only comparison completed on 2026-10-20 before further source edits. The later [morning selection](MORNING-SELECTION.md) satisfies only the design-choice gate; this reconciliation and the other acceptance gates remain applicable. Scope remains feasibility prototype, review remediation and design options. Production implementation requires the user's design choice and unresolved review gates.

## Recovered state

- Sole-owner branch: `room/cr8-select-and-refine-workflow-fsgq`.
- Recovered HEAD: `8d2c7a883ace2620cbb4d53df6bfb864b2b7498d`.
- All 27 tracked modifications and the untracked `out/desktop-crop-extras-redacted.png` matched the coordinator's snapshot and were preserved. No reset, checkout, rebase or merge occurred.
- The interrupted rerun's ignored `out/test-results.json` contains a browser-closed suite failure. The previous 162/162 report is historical, not evidence that the interrupted rerun completed.
- No server or test process from that run was active when recovered. Resume validation uses a scratch copy so tracked evidence is not overwritten.

## Published source comparison

Official upstream v111: `574c4f9181648f385f6175aa628f6fd18b6f5451` (published from private commit `9bbf5c8586cc676a13c766ca0103d7df3bb25567`). `git ls-remote upstream refs/heads/main` returned that exact published hash during reconciliation.

The branch's `gui/` tree is byte-identical to its v109 base, `15cc574c8ff29788b7556f7d26bbddf670479b71`. Against v111, 257 GUI paths differ (2,102 additions and 9,431 deletions when viewed from v111 to this branch). These are upstream evolution, not CR8 edits. All CR8 implementation changes are isolated in `prototypes/cr8-select-refine/`. Nothing was wholesale imported.

| v111 change | Published source | CR8 overlap / acceptance requirement |
| --- | --- | --- |
| Calm Cloud errors and one live disk card | `apps/app/src/views/thread-detail/ThreadDetailPromptArea.tsx`, `components/CloudUsageLimitNotice.tsx`, `hooks/queries/cloudroom-queries.ts`, `packages/thread-view/src/parse-operation-message.ts` | Direct overlap with the proposed sender/review placement. Preserve existing handlers, readiness and move-to-local guards. Consume the structured `disk` state; retain capacity and measurement-unavailable handling. Do not recreate disk timeline spam or hide the status card behind review. |
| Provider usage-credit API-price warnings | `plugins/provider-usage/app.tsx`, `usage-schema.ts`, provider usage contracts | No direct prototype overlap. Retain footer alerts and existing permission-gated notifications. CR8 must not change accounts, enroll in credits, purchase, request notification permission, or obscure warnings. |
| Loops retain/display their selected agent and model | `plugins/automations/src/cli.ts`, `rpc.ts`, SDK cloud contract | No direct overlap. CR8 never creates an agent or loop, and must preserve the current thread's agent/model/reasoning/tier when sending. No loop settings changed. |
| Sticky code-block Copy | `apps/app/src/components/ui/markdown-preview.tsx` | No direct overlap. Retain sticky positioning and overflow behavior; drawer/preview integration needs a regression check that it does not clip or cover Copy. |
| Earlier offline Mac detection | `apps/connect/src/tunnel-do.ts`, `apps/app/public/sw.js`, `cloud/cloud-mode.ts` | Direct overlap with preview availability. v111 expires silent tunnel sockets after 30 seconds, excludes system/version from cached API fallback, and scopes cached API state using `x-cloudroom-mac`. Reuse this behavior. Mac changes/offline invalidate the selection; cached state is not proof of a live preview. |
| Phone app origin and account/Mac routing (v110–v111) | `apps/connect/src/worker.ts`, `plugins/connect/src/tunnel.ts`, `cloud/cloud-mode.ts` | Phone app is `https://app.<base>`. Share handoff uses `/__share?mac=…` then share `/__pair`. A port's `resolved.publicOrigin` is the share origin. Supply a distinct trusted app-origin allowlist. Real iOS framing/session compatibility remains unverified. |
| Cloud message limit increases to 256 KB | `apps/server/src/services/cloudroom/commands.ts` | No reason to enlarge CR8's minimal-context payload. Retain bounded schema and transport checks; actual send shape remains `input: PromptInput[]` plus queue mode and stable request ID. |

Paths in the table are relative to `gui/` at the exact v111 hash. Original v109 line references in FINDINGS.md are historical where code moved.

## Preserved gates

1. No production UI before the user's desktop/mobile design choice. The mock's custom sheet is not approval to replace the existing persistent responsive drawer.
2. Exact-head independent review is required for a new checkpoint. Reviews of `b112362` or `8d2c7a8` cannot approve later changes. See REVIEWS.md.
3. No new or replacement agent jobs. No Claude starts, continuations or wake-up messages. Former Claude review endpoints returned no saved output; retain honest historical attribution from the supplied conversation.
4. Real iPhone Safari/WKWebView authentication and rasterization, reliable share ownership, malicious-page trust and phone rendering performance remain open. Device and private integration claims cannot be inferred from loopback tests.
5. No merge, upstream PR, publication, deployment, auto-install, credentials/billing changes or SF1 work. Desktop updates remain with the coordinator.

The requested coordinator setting is Codex `gpt-6.1-sol`, High/Fast. This session identifies as Codex; the available cloud CLI does not expose verifiable effective model/effort/tier metadata. Child titles and awake/asleep states are not provider-configuration proof. No child configuration was changed or child actor messaged during this reconciliation.
