# Guided cloud setup: design checkpoint

Two isolated, runnable UX options in the actual app source. Production onboarding, authentication, scopes, permissions, session behavior, and default billing are unchanged. Stop here for the user's design choice before integrating production effects.

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

Recommendation: A for first-run setup. B is useful for returning users who want the whole setup in view. Both follow the same dedicated-wizard direction and use the same fixture transitions.

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

## Verification checkpoint

The fixture transition suite covers truthful readiness, mismatched/late receipts, interrupted setup, reconciliation before retry, duplicate retry prevention, cancellation, No project, denied repo access, expired provider authentication, provider failures, and persisted approvals. These tests verify the prototype only. Production integration tests remain required after the design choice.

Run through Turbo:

```sh
pnpm exec turbo run build:onboarding-preview typecheck:onboarding-preview --filter=@cloudroom/app --concurrency=2
pnpm exec turbo run test --filter=@cloudroom/app --concurrency=2 -- src/dev/onboarding-preview/fixtures.test.ts
```

At this checkpoint the prototype build, scoped typecheck, all 16 fixture tests, and 60 browser assertions pass. Browser checks exercise A at desktop size and B at mobile size, including leaving/reopening, approval decisions, cancellation, safe retry, no-project recovery, expired auth, disabled sending, and same-origin resources. Independent review found and prompted fixes for focus leaving an open drawer during phase changes and false saved-progress claims after storage failure. Sixteen browser regression assertions cover both fixes in both options. Screenshots cover both options at desktop and mobile widths; iOS Safari has not been tested. Required broader checks were attempted: the app typecheck fails on the unchanged `Automations.stories.tsx:630` missing `onNewUrl`; the combined build/typecheck command stops there. Config tests pass (113). Scripts tests pass 128 and fail 5: published-snapshot CI workflow helper paths are missing, and the provider-literal baseline is out of date. A direct scan of the base snapshot and final source gives identical provider-literal maps (299 references each). The preview lives under the existing `src/dev` fixture namespace without changing the guardrail. Do not treat this branch as production/PR ready. No merge, deployment, or PR publication is authorized.

Desktop/mobile screenshots and browser interaction evidence are separate review artifacts, not shipped app assets. An independent Codex review must identify the exact final commit. Choose A or B before production integration starts.
