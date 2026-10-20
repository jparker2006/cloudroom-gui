# Guided cloud setup: design checkpoint

Jake selected **1/A: focused steps**, one question at a time with numbered choices, on 2026-10-20. Selection is recorded separately from implementation, review, and shipping. A now implements that question sequence inside the existing isolated fixture entry. B remains an earlier comparison. Production onboarding, authentication, scopes, permissions, session behavior, and billing remain unchanged while the integration blockers below are unresolved.

## Bounded morning resume

The starting checkpoint was verified before source changes: branch `room/onboarding-wizard-options-jrhv`, HEAD `b7c7fb5c5f3921e312fd3bf83ab6dc4ace33ffbe`, tree `0152ca91a8ef3d7b4df72fb7bd769966c04231b1`, zero dirty files, empty staged/unstaged diff SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. No unexplained drift was present. The public `room-cli thread show` API confirmed the existing cloud owner uses Codex `gpt-6.1-sol`, xhigh. Existing children remained sleeping; no actors were created or awakened. Earlier artifacts and review history were preserved.

Before frontend implementation, the Cloud skill catalogue and public `SKILL.md` paths were inspected. No applicable frontend/product-UI skill was exposed. Public reads covered `/home/cloudroom-agent/.agents/skills/browser-harness/SKILL.md` (declared name/title `browser-harness`, no declared version) and `/home/cloudroom-agent/.codex/plugins/cache/openai-curated-remote/cloud-environment/0.1.2/skills/runtime/SKILL.md` (`cloud-environment-runtime`, no declared version). The latter's environment-status tool and policy snapshot were absent here, so no managed-environment readiness was inferred from that plugin. Product guidance came from `gui/AGENTS.md`, shared components, typography/theme tokens, and Jake's direction. No tasteskill, design-taste-frontend, or Mac-only frontend skill was applied or claimed. No skill, framework, dependency, or design-system installation was made.

The implemented sequence asks for identity, provider, secure connection, model, project or No project, and explicit read-only-check consent separately. Answers are numbered. Provider choice cannot initiate authentication by itself. Repository selection follows connection and model choice; No project has equal treatment. Before verification consent there is explicitly no cloud session. A completed matching fixture execution still gates the composer. Save/reopen, approval, unknown cancellation, retry reconciliation, denied repository access, expired provider auth, and unknown billing remain supported as honest fixture states.

Source APIs were rechecked rather than assumed: `account.ts` accepts `provider: "github"`; provider flows remain secure existing code; thread status/events/interactions exist. `setup-step` remains telemetry, not orchestration. `sandboxLogin` still returns `plan: null`; the GitHub device flow still requests `repo read:org workflow`; retry-start remains limited to a recorded failed start with no session. Durable wizard orchestration, selected-repository grants, authoritative provider billing, actual setup-thread association, and pre-session cancellation are still blocked integration capabilities. This candidate adds no guessed endpoint and does not activate a partial production wizard.

New regressions were written and run before the fixes: four transition tests and four real-browser checks failed against the preserved checkpoint. They then passed after the sequence/numbering change. Nine further guard checks were added after that first fix and are labeled retrospective, as are the earlier 16 fixture tests. Retrospective sensitivity runs execute the actual earlier fixture tests with isolated transform-time faults in operation-receipt matching and retry reconciliation; their expected assertion failures are required for the sensitivity tests to pass. This is fault-injection evidence, not a claim of test-first chronology or a newly reproduced production bug. Initial harness/configuration failures are separate artifacts and are not counted as behavior failures. After green, unused old choice-layout CSS was removed as the refactor.

Current unit command includes all scoped tests:

```sh
pnpm exec turbo run test --filter=@cloudroom/app --concurrency=2 -- src/dev/onboarding-preview --maxWorkers=2
```

The scoped candidate has 31 passing tests (the four test-first regressions, nine later guard checks, 16 retrospective fixture checks, and two retrospective sensitivity checks) and 111 passing real-browser assertions across desktop/mobile paths and 1440/390/320px overflow checks. Preview build and scoped typecheck pass. The required broader command still stops on the unchanged Automations story missing `onNewUrl`; config tests pass 113 and scripts retain five snapshot/baseline failures. Base/candidate provider-literal scan maps are identical at 299 references. Exact new head/tree and raw evidence belong in the freeze report. The earlier independent signoff on `b7c7fb5` does not cover this changed code. Root must reconcile a new exact-final-head independent review, CI, device, signed-in, security, accessibility, and acceptance gates before any production/PR-readiness claim.

## Installation/help reports to verify

Jake reported duplicate PWA installation and missing update instructions. These are **user reports to verify**, not proven bugs, and remain part of this onboarding/help review. No separate task or installation experiment was created.

The current manifest declares `start_url: "/"` and standalone display. `cloud-mode.ts` registers `sw.js`; the service worker uses network-first page navigation, cached offline fallback, `skipWaiting`, and `clients.claim`. Those facts do not prove which installed copy a device opens or whether it updated. Desktop `UpdatesSettingsSection.tsx` already offers Relaunch for downloaded updates; the initial onboarding has no equivalent PWA help. The selected candidate adds a small help drawer that points to existing desktop update guidance and labels the PWA reports unverified.

Remaining device checks: record the existing icons, device/browser, and app address; determine whether both icons open the same origin/install identity; compare the visible build before/after the supported update path; test reopening online versus offline without another installation. Real-device and signed-in verification is still open. No install, uninstall, cache/credential clearing, account connection, or security change was performed or prescribed as setup.

## Run and compare

From `gui/`, with the repository's supported Node version and installed dependencies:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run onboarding:preview --filter=@cloudroom/app
```

Open `http://127.0.0.1:4173/onboarding-preview.html?option=a&state=identity`, or change `option=b`. The server binds only to IPv4 loopback, has no backend proxy, and uses existing dependencies. The normal app entry never imports the prototype. The preview HTML is not included in the normal production build.

| Option             | Benefit                                                                             | Cost                                                                         |
| ------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A: Focused steps   | One decision at a time, clear stage and recovery message, shorter mobile path       | Earlier choices are summarized rather than continuously visible              |
| B: Setup checklist | Every stage and its completion status stay visible, with a persistent setup summary | More vertical scrolling on mobile; current action sits below completed steps |

Jake selected A for first-run setup. B is retained as the earlier comparison. Both share the fixture transition layer; A is the candidate under implementation.

The fixture selector loads sign-in, provider connection, project selection, progress, approval required, failed step, resumed setup, verified success, denied repository access, expired provider authentication, and cancellation. `state=verifying|approval|failed|resumed|success` provides reproducible links for either option. Explicit fixture links replace the saved preview state. After loading, the URL drops `state` so a normal reload restores progress instead of restarting the fixture.

All identity, provider, repository, provisioning, approval, and execution effects are test doubles. Simulated execution requires an explicit fixture control. No real account, provider, repository grant, infrastructure, or paid verification task is created. The composer accepts draft text but cannot send. Models are illustrative fixture selections, not a live availability catalog. Billing mode remains unknown, even after successful execution.

The preview reuses `Button`, `Icon`, `BbLogo`, theme/typography tokens, and `PersistentResponsiveDrawerShell` without editing those shared components. “View details” opens a labeled fixture session viewer; on mobile it also remains in a fixed bottom bar. Production must open the actual setup thread with its existing timeline and interaction controls. The advanced fallback must open that same thread, rather than a duplicate owner/session.

## Existing work and independent investigations

Inspected the existing owner threads and repository branches before creating helpers. There was one onboarding owner, this thread, and no onboarding implementation branch. The UI project checkout was clean at `15cc574c8ff29788b7556f7d26bbddf670479b71` (`Publish GUI source for v109`). It was cloned into the cloud; all development ran here.

Two bounded, read-only Codex Luna investigations independently inspected identity/provider/repository auth and cloud bootstrap/session recovery. Their findings were combined with the owner's UI inspection. No additional owner or shared-component changes were created.

## What works now

| Area                     | Existing implementation and practical limit                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dedicated onboarding UI  | [`Onboarding.tsx`](../apps/app/src/components/Onboarding.tsx) already has Sign in, Connect an agent, Connect GitHub, and Import your work. Completion is account ID + agent connection + GitHub auth. It does not verify selected-model execution, and makes repository auth part of completion.                                                                                                                                                          |
| Cloudroom identity       | [`account.ts`](../apps/server/src/services/cloudroom/account.ts) accepts an identity provider, including GitHub. `POST /api/v1/cloudroom/account/sign-in` opens browser sign-in. State, PKCE, one-use handoff, and loopback callback remain the security boundary. The current UI does not request a specific identity provider.                                                                                                                          |
| Provider connection      | Existing [`ClaudeConnection.tsx`](../apps/app/src/components/ClaudeConnection.tsx), [`CodexConnectionPanel.tsx`](../apps/app/src/components/CodexConnectionPanel.tsx), and [`commands.ts`](../apps/server/src/services/cloudroom/commands.ts) expose secure connection flows. Preserve explicit login-copy consent and direct secure credential storage. Cloud auth `connected` can mean a saved credential exists; it is not proof that execution works. |
| Billing                  | Sandbox Codex/Claude status in `commands.ts` returns `plan: null`. Plan metadata from local telemetry is not a verified billing mode or usable quota. Cloudroom's cloud plan is separate from provider billing. Show unknown unless an authoritative signal exists. Never add API fallback.                                                                                                                                                               |
| Repository discovery     | [`repo-suggestions.ts`](../apps/server/src/services/cloudroom/repo-suggestions.ts) lists accessible suggestions and creates project records. `GET /api/v1/cloudroom/account/repo-suggestions` and `POST .../repo-suggestions/github` exist. Adding a project is not proof it can be cloned.                                                                                                                                                               |
| Repository authorization | [`github-login.ts`](../apps/server/src/services/cloudroom/github-login.ts) is distinct from identity sign-in and currently requests `repo read:org workflow`. It cannot grant access to only one selected repository. No-project setup must bypass it. The prototype's narrow grant is explicitly proposed, not an available API.                                                                                                                         |
| Thread startup           | [`commands.ts`](../apps/server/src/services/cloudroom/commands.ts) persists a pending thread, binding, first prompt, and `startRequestId`; background delivery later calls Core session start in [`client.ts`](../apps/server/src/services/cloudroom/client.ts). A returned session ID establishes session creation, not model completion.                                                                                                                |
| Status and details       | `GET /api/v1/cloudroom/threads/:id` exposes `starting`, `sessionId`, `failedStart`, `authRequired`, and errors. `.../:id/workspace` exposes workspace state. [`events.ts`](../apps/server/src/services/cloudroom/events.ts) writes provisioning events; normal thread events and interaction APIs expose actual progress and approvals.                                                                                                                   |
| Retry and recovery       | Saved bindings, commands, request IDs, and event cursors survive service restart. `POST /api/v1/cloudroom/threads/:id/retry-start` is limited to a recorded failed start with no session. A thread stop is not a pre-session provisioning cancel. Reuse existing request IDs and reconcile uncertain outcomes.                                                                                                                                            |

## Bootstrap boundary

```text
App + secure browser, no cloud thread yet
  GitHub identity sign-in -> authenticated account handoff saved
  -> explicit provider connection -> project choice (or No project)

Authenticated app can now request a setup thread
  durable pending thread + stable start request ID
  -> Core session acceptance -> sandbox/provider progress and approvals
  -> completed read-only execution by the selected model
  -> verified readiness -> composer
```

The initial login does not run inside an already-provisioned session. “View details” before session creation must show local bootstrap status and explicitly say there is no cloud session yet. After thread creation it must retain the real thread identity across leaving, retrying, and resuming. Shared cloud provisioning may be initiated by account handoff depending on backend mode; this is still separate from a per-thread agent session.

## Missing integration, not invented endpoints

- There is no durable setup orchestration API, setup operation record, or aggregate verified-readiness contract. `POST /api/v1/cloudroom/setup-step` is telemetry only.
- There is no narrow selected-repository grant in this snapshot. Do not wire the fixture's narrow grant to the broad existing device flow. An existing-authorized-repository path and No project can be integrated first; new narrow permissions require a supported backend capability.
- There is no authoritative provider billing-mode signal in the current sandbox auth response. Keep the UI unknown until one is available. A successful task proves execution, not billing mode.
- There is no generic pre-session cancel-start endpoint. Do not claim a local Cancel has already stopped remote provisioning. Persist stop intent, reconcile the existing start, and use only supported session actions once their target exists.
- Readiness must correlate a terminal successful run and expected response with the current operation, provider, model, project, and auth context. Neither saving config nor accepting a launch suffices. The fixture models this with a synthetic receipt; it is not a server security contract.
- Browser storage here demonstrates leaving/reopening and preserves approval/cancellation/unknown status. It does not provide cross-device recovery, remote reconciliation, or production cancellation. Those require server-owned state or a narrowly scoped durable association with an existing thread.

## Historical verification checkpoint at b7c7fb5

The fixture transition suite covers truthful readiness, mismatched/late receipts, interrupted setup, reconciliation before retry, duplicate retry prevention, cancellation, No project, denied repo access, expired provider authentication, provider failures, and persisted approvals. These tests verify the prototype only. Production integration tests remain required after the design choice.

Run through Turbo:

```sh
pnpm exec turbo run build:onboarding-preview typecheck:onboarding-preview --filter=@cloudroom/app --concurrency=2
pnpm exec turbo run test --filter=@cloudroom/app --concurrency=2 -- src/dev/onboarding-preview/fixtures.test.ts
```

At this checkpoint the prototype build, scoped typecheck, all 16 fixture tests, and 60 browser assertions pass. Browser checks exercise A at desktop size and B at mobile size, including leaving/reopening, approval decisions, cancellation, safe retry, no-project recovery, expired auth, disabled sending, and same-origin resources. Independent review found and prompted fixes for focus leaving an open drawer during phase changes and false saved-progress claims after storage failure. Sixteen browser regression assertions cover both fixes in both options. Screenshots cover both options at desktop and mobile widths; iOS Safari has not been tested. Required broader checks were attempted: the app typecheck fails on the unchanged `Automations.stories.tsx:630` missing `onNewUrl`; the combined build/typecheck command stops there. Config tests pass (113). Scripts tests pass 128 and fail 5: published-snapshot CI workflow helper paths are missing, and the provider-literal baseline is out of date. A direct scan of the base snapshot and final source gives identical provider-literal maps (299 references each). The preview lives under the existing `src/dev` fixture namespace without changing the guardrail. Do not treat this branch as production/PR ready. No merge, deployment, or PR publication is authorized.

Desktop/mobile screenshots and browser interaction evidence are separate review artifacts, not shipped app assets. A is now selected. A new independent Codex review must identify the exact final candidate commit; the historical review above is not reused.
