# CR8 — Select and refine: findings

Status: **desktop A / desktop 1 and phone A / mobile 1 selected** in the bounded morning resume. See [selection source anchors and correction evidence](MORNING-SELECTION.md). Prototype remediation and any production integration remain gated on exact-head independent review and the unresolved device/privacy/source-anchor checks. Nothing here changes `gui/` or ships UI. See [v111 reconciliation](RECONCILIATION.md) and [review ledger](REVIEWS.md) for the recovered state and remaining gates.

## 1. Revisions inspected

| Repo | Ref | Commit | Notes |
| --- | --- | --- | --- |
| jparker2006/cloudroom-gui (origin) | `main` | `15cc574c8ff29788b7556f7d26bbddf670479b71` | "Publish GUI source for v109". This branch starts here. |
| davidondrej/cloudroom-gui (upstream), original research | historical `main` | `5f7a5f9ef553149d28347c696a209aa8fcd84166` | v110 + Windows saved-connection fix. Historical evidence only. |
| davidondrej/cloudroom-gui (upstream), resumed reconciliation | published v111 / `main` | `574c4f9181648f385f6175aa628f6fd18b6f5451` | Verified with `git ls-remote upstream refs/heads/main` on 2026-10-20. 257 GUI paths differ from the v109 baseline; no upstream changes imported. |

Paths below are relative to `gui/`. Original line references describe origin v109 unless marked upstream; the v111 differences and acceptance gates are recorded separately in RECONCILIATION.md.

## 2. Known constraints — verified

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Desktop browser uses Electron `WebContentsView` with native capture and CDP | **True** | `apps/desktop/src/desktop-browser-view.ts`, `desktop-browser-cdp.ts`, `desktop-browser-cdp-adapter.ts` (debugger attach/ownership) |
| Existing capture is full-viewport, not a privacy-safe crop | **True** | `captureTab` (`desktop-browser-view.ts:991`) → `captureDesktopBrowserPage` (`desktop-browser-capture.ts:71`): whole page, resized to max size, JPEG. Exposed via `captureTab` route (`packages/server-contract/src/public-api.ts:734`) and `bb browser`. No clip, no masking. |
| Sandboxed HTML previews lack a DOM bridge | **True** | No bridge in app; web/phone build shows "Browser tabs need the desktop app" (`apps/app/src/components/secondary-panel/BrowserTabContent.tsx:314`). |
| Upstream `experimental_page` evaluate/onMessage declared but unsupported | **True, upstream only** | Declared at upstream `packages/plugin-sdk/src/app-contract.ts:314`; app passes `UNSUPPORTED_BROWSER_PAGE` that rejects (upstream `apps/app/src/components/plugin/PluginBrowserToolbarActions.tsx:49`). **Not present at all in origin v109.** |
| Thread sharing exports conversation text | True | `apps/app/src/components/SharedThreadOpener.tsx`; not a live-app channel. Not used. |
| Connect port shares provide live app access | True, **on a separate origin** | `https://<handle>--<port>.cloudroom.run` vs phone app `https://app.<base>` in v111 (historical host app: `https://<handle>.<base>`). See upstream `apps/connect/src/worker.ts:357–366,600–650` and `apps/app/src/cloud/cloud-mode.ts`. Different origins mean the app cannot read the share's DOM or pixels. Cookie behavior on real iOS remains unverified. |

Additional facts that shape the design:

- **Phone has no in-app preview today.** Phones open share URLs as browser links.
- **Shares are host+port, not thread.** `ShareListing` (`plugins/connect/src/types.ts`) has no thread or project. Two threads on one Mac can both "own" port 3000 over time.
- **The relay 404s every `/__*` path on share hosts** (upstream v111 `apps/connect/src/worker.ts:458`), but forwards everything else to the host's tunnel client (`packages/tunnel-client/src/session.ts:271 executeHttp`). The tunnel client is public code in this repo.
- **Share session cookie is `SameSite=Lax`** (v111 `worker.ts:215–216`). Same-site cookies are expected to flow only after session establishment; deployed iOS auth redirects/framing are still unverified.
- **Send path:** `handleSend` (`apps/app/src/views/thread-detail/ThreadDetailPromptArea.tsx:1011`) queues when the run is active (local: `createQueuedMessage`; cloud: `mode: "queue-if-active"`, line 999). Steering is a separate opt-in (`steerActiveThreadOnEnter`). `handleSend` clears and restores **the composer draft**, so it cannot be reused as-is without touching the user's draft.
- **Attachments:** `useComposerAttachmentUploads` → `useUploadPromptAttachment` (`useComposerAttachmentUploads.ts:109`) uploads a `File` per project and returns a draft attachment path.
- **Native iOS shell** (private) exposes only `haptic, badge, share, open-external, safe-area, open-native` (`packages/mobile-bridge/src/handshake.ts:14`). No webview capture.
- **Agent CDP leases** own the tab's single `webContents.debugger` (`desktop-browser-cdp-adapter.ts`). Selection must not steal it.

## 3. Source and ownership map

| Area | Owner / repo | Public? | Role in CR8 |
| --- | --- | --- | --- |
| Desktop browser tabs, capture, CDP | `apps/desktop` (Electron main) | Public | Native selection: CDP inspect mode, clipped capture, isolated-world context. |
| Desktop browser IPC contract | `apps/desktop/src/desktop-browser-ipc.ts`, `packages/desktop-contract` | Public | Add select start/cancel/result channels. |
| Browser panel UI | `apps/app/.../secondary-panel/BrowserTabContent.tsx` | Public | "Select" toolbar button and review panel (desktop). |
| Phone preview panel | `apps/app/.../secondary-panel/*` | Public | New: share-backed preview tab on web/phone (today: `BrowserUnavailable`). |
| Composer, send/queue, attachments | `apps/app/src/views/thread-detail/ThreadDetailPromptArea.tsx`, `embedded-chat/*` | Public | Reuse: upload + queue-if-active send without touching the draft. |
| Port shares (expose/list) | `plugins/connect` | Public | Reuse; add optional `threadId` on expose. |
| Share proxy on the host | `packages/tunnel-client` | Public | Serve the select shell at a reserved path. |
| Relay `cloudroom.run` | `apps/connect` (Cloudflare Worker, deployed by David only) | Repo-public, deploy-private | Reserved shell path appears forwardable; deployed authentication/framing remains an integration gate. |
| Website / accounts `cloudroom.dev` | Private | Private | No change needed. |
| Native iOS/Android shell | Private | Private | No change needed. Optional later: native capture capability. |
| Plugin `experimental_page` (upstream) | `packages/plugin-sdk` | Public | Not used. Could later be backed by the same desktop isolated-world code. |

## 4. What the prototype proves

Hardest path first: phone. Then desktop.

**Phone (select shell, `shell/`):** the Cloudroom app embeds the share origin's shell; the shell embeds the app at the same origin and owns a transparent tap catcher. Taps never reach the page, drags scroll it, a tap picks one element, the highlight is drawn outside the page DOM, context is extracted with `shared/element-context.js`, and a crop is rendered locally from the DOM with detected sensitive areas burned in before anything leaves the shell. If the crop intersects a nested scrolled region, no image is returned. The app validates, re-redacts, shows review, and only uploads on Send.

**Desktop (real Electron 44, `desktop/electron-select.cjs`):** CDP `Overlay.setInspectMode(searchForNode)` on the tab's `WebContentsView`. The click is consumed by the inspector. Context runs in a CDP isolated world (page scripts can't tamper with it). `Page.captureScreenshot` with `clip` gives a native crop; masks are burned into the bitmap in the main process.

Historical fixture coverage below; fresh outcomes and the scratch result paths are in REVIEWS.md. The recovered ignored `out/test-results.json` is an interrupted run, not a current pass:

| Check | chromium-phone (touch) | webkit-phone (touch) | chromium-desktop | Electron 44 |
| --- | --- | --- | --- | --- |
| Tap/click never reaches page (clicks, pointerdown, touchstart, links, inline handlers) | ✅ | ✅ | ✅ | ✅ (0 clicks, 0 pointerdowns) |
| Highlight matches element (≤1px) | ✅ | ✅ | ✅ | ✅ exact rect |
| Crop vs real screenshot of same region | ✅ ~7% px differ (outline+AA) | ✅ ~6% | ✅ ~6% | native pixels |
| Drag/wheel scrolls in selection mode | ✅ | ✅ | ✅ | n/a |
| Password, card, email, form values masked in pixels; none in text | ✅ | ✅ | ✅ | ✅ |
| Fixture hidden inputs and known secret patterns excluded | ✅ | ✅ | ✅ | ✅ |
| Prompt-injection text sent only as quoted "page data, not instructions" | ✅ | ✅ | ✅ | — |
| Source hint only when found in the project | ✅ (bad path dropped) | ✅ | ✅ | candidate returned |
| SPA nav / reload / thread switch invalidate selection | ✅ | ✅ | ✅ | ✅ navigation |
| Late result from older page rejected | ✅ | ✅ | ✅ | ✅ |
| Forged messages: no HTML execution or automatic send; rendered data still forgeable | ✅ | ✅ | ✅ | n/a (isolated world) |
| Selection refused while an agent holds the debugger | — | — | — | ✅ |
| Running thread → queued, never steered; idle → sent; queue drains | ✅ | ✅ | ✅ | — |
| Existing composer draft untouched | ✅ | ✅ | ✅ | — |
| Cancel / remove image / manual hide area | ✅ | ✅ | ✅ | — |
| Keyboard: Tab, Enter, Escape | ✅ | ✅ | ✅ | — |
| Preview that forbids framing → explained, Select disabled | ✅ | ✅ | ✅ | — |
| Shell refuses to be framed by other sites | ✅ | ✅ | ✅ | — |

The original 102/102 browser checks and Electron pass are historical. The recovered remediation adds checks; current rerun results are recorded in REVIEWS.md. These fixture checks do not establish general privacy safety or deployed phone compatibility. The desktop highlight is the Chromium inspector overlay (`Overlay.highlightNode`); it needs `DOM.getDocument` first or it silently draws nothing, and it is not included in `capturePage`, so it can't leak into crops. Evidence is a screen grab, `out/desktop-native-highlight.png`. Two real bugs were found and fixed on the way: WebKit ignores SVG `viewBox` offsets for `foreignObject` (crop showed the wrong area), and WebKit's `-webkit-standard` font rendered as serif.

Evidence: `out/` (crops, uploaded images, highlight), `designs/` (renders below).

## 5. Smallest contracts

### 5a. Phone: proposed select shell on the share origin

- **Where:** `packages/tunnel-client` `executeHttp`, before proxying: `GET /.well-known/cloudroom/select/*` is answered by the host, never forwarded to the user's server. Must not start with `/__` (relay blocks it).
- **Headers:** `Content-Security-Policy: frame-ancestors <trusted app origin allowlist>; script-src 'self'; ...`, `Cache-Control: no-store` (relay won't cache), `Referrer-Policy: no-referrer`.
- **App origin pinning:** supply a distinct trusted `appOrigins` allowlist from host configuration. v111 must explicitly support `https://app.<base>`; include a legacy host app origin only where supported. The port target's `resolved.publicOrigin` is the **share origin**, not an app origin (`plugins/connect/src/tunnel.ts:261`). Neither it nor the non-port credential origin alone supplies the phone app origin. Pin the first authenticated parent origin from that allowlist; never trust an origin query parameter or wildcard.
- **Messages** (`cr8: 1`, all JSON, ≤4 MB):
  - app → shell: `hello {previewId}`, `select:start {nonce}`, `select:cancel`, `select:step {parent|child}`, `select:reveal {bottomInset}`, `check {nonce}`, `select:list`, `select:pick {index}`
  - shell → app: `navigated {generation, path}`, `unavailable {reason}`, `select:result {nonce, seq, generation, element, crop}`, `select:ended`, `checked {nonce, generation, valid}`, `select:busy`, `select:list {items}`
- **App rule:** accept only `origin === shareOrigin && source === shell iframe && previewId && nonce && generation` match; schema-validate; PNG data URL only; re-redact strings; render as text; never auto-send. Phone messages can claim only `rendered` or `unavailable`; `native` provenance comes exclusively from desktop IPC. Revalidate URL/generation with the shell immediately before sending, after asynchronous preparation, and reject changed ownership.

### 5b. Desktop: three IPC channels

`bb-desktop:browser:select-start {ref: NativeTabRef}` / `select-cancel {ref: NativeTabRef}` / event `select-result {ref, generation, element, crop{png, area, masks}}`. Preserve the existing `requireNativeEntry` checks for tab, thread and generation; route ownership through the desktop CDP adapter. Refuse an agent-owned lease, release only selector-owned attachments on every failed start/cancel/navigation/detach, and remove selector listeners. The isolated prototype exercises raw Electron primitives, not the production adapter integration. Context runs in an isolated world; masks include opaque embedded content and closed shadow hosts.

### 5c. Shared result schema

One zod schema in `packages/desktop-contract` used by both paths: `{ element: {tag, role, name≤120, text≤200, selector≤300, path, rect, viewport, style{6}, sourceCandidate?}, crop: {kind: "native"|"rendered"|"unavailable", png?, target, scale, masks[]} }`.

### 5d. App send

Leave `handleSend` and `sendCloudDraft` unchanged. Add a separate sender built on the existing follow-up builders and mutations, with the same readiness, execution-update and `movingToLocal` guards. Fix `mode` to queue-if-active; preserve the current agent/model/reasoning/service tier and the composer draft.

Production input uses `PromptInput[]`: `[{type: "text", text, mentions: []}, {type: "localImage", path}]` (omit the image part when removed/unavailable). Upload only through `useUploadPromptAttachment` using the existing multipart project attachment endpoint. Pass the thread `id` in the SDK mutation and retain one request ID for retries of the same submission via the existing cloud request-ID mechanism. Never double-deliver after an uncertain response.

The prototype's raw PNG upload and `{projectId,text,attachments,mode}` mock are deliberately **not production wire contracts**. Keep v111's calm error line, live disk card and provider credit warnings visible; do not enroll in credits or change billing.

### 5e. Share ↔ thread

Add optional `threadId` to `connect expose` / `ShareListing` when exposed from a thread. Phone Select requires trusted host/share ownership tied to the current thread and project, with invalidation on port reuse. Missing, unknown or foreign ownership disables Select; labels alone are insufficient. The mock now tests foreign-thread disabling, but cannot prove real relay ownership.

## 6. Blockers and open risks

| # | Item | Type | Needed before production? |
| --- | --- | --- | --- |
| B1 | **Real iPhone check of the iframe share session.** The share cookie is `SameSite=Lax` and same-site, so it should flow in the iframe, including v111's `app.<base>/__share?mac=…` → share `/__pair` hop, existing sessions, remote hosts, and account/Mac switching. Unverified on iOS Safari and the native shell's WKWebView; an unauthenticated iframe must never silently initiate a new grant or public share. | Verification | Yes. Can't be done in this sandbox. |
| B2 | **iOS canvas rasterization of foreignObject.** Playwright WebKit (Linux) works; iOS Safari may taint or differ. If it fails, the shell already falls back to "No image, details only". | Verification | Yes. |
| B3 | If `cloudroom.run` is ever added to the Public Suffix List, handles become separate sites and Safari will block the iframe cookie. | Decision (David) | Note only. |
| B4 | v111 phone Cloud mode can continue while its Mac is offline, but a Mac-hosted preview cannot. Reuse live offline headers and Mac selection; invalidate selection immediately on host changes/offline. Do not treat cached app state as a live preview. | Integration | Required; not proved by the loopback mock. |
| B5 | **The shell is same-origin with the user's app**, so the app's own scripts can spoof what the review shows (historically, forged review content was sendable after a user click). Current phone transport refuses native-image claims, but same-origin code can still forge rendered context. No automatic execution/send was demonstrated. Desktop uses a separate isolated path. | Unresolved trust risk | Requires independent re-review and your explicit decision; no acceptance inferred. |
| B6 | `ShareListing` has no thread link (5e). | Small public change | Yes, for wrong-project prevention. |

No private service change has been demonstrated as necessary for the reserved-path prototype. Deployed v111 phone auth/framing and ownership must be verified before concluding that no relay or private integration work is needed.

## 7. Limitations

- Phone crop is **rendered from the DOM**, currently labeled "Rendered · may differ slightly"; that wording understates the possible mismatch and needs review. Lost: cross-origin images, `<canvas>`, video, iframes, pseudo-elements' generated content in some cases, web fonts not inlined, `position: fixed` offsets while scrolled. Real pixels need a native capture capability (private shell) — not proposed now.
- Rendering clones the whole document and inlines computed styles; the 5,000-element cap falls back to details only. Large pages can stall despite the busy indication. Target-only rendering and representative phone performance checks remain open. Crops intersecting nested scrolled containers now fail closed to details only.
- Pattern matching is not a guarantee against arbitrary secrets or all CSS/shadow clipping cases. Opaque content and cross-node text need adversarial exact-head review.
- Apps that send `X-Frame-Options: DENY` or `frame-ancestors 'none'` can't be inspected on phone. The prototype says so and disables Select. Desktop is unaffected.
- Only the top document. Elements inside nested iframes select the iframe.
- React source hints come from `data-inspector-*` attributes or React ≤18 `_debugSource`. In the desktop isolated world, React fiber expandos aren't visible; only attributes work there. Hints are sent only if the file exists in the project.
- Secret detection is pattern-based (keys, JWTs, long tokens, emails, card numbers). It can miss unrecognized secrets as well as over-redact. Users can hide more areas or remove the image.
- Selection is one element; "Parent/Child" refines it.

## 8. Design options

Interaction is the approved one in all options: Select → one element → highlighted preview beside an editable request → explicit Send/Queue through the thread's queue. Target project › thread is always shown. Draft untouched.

**Desktop A / desktop 1 — selected, docked under the preview.** Review sits under the live preview it refers to. Chat stays readable. Recommended.
![Desktop A](designs/desktop-A-docked-in-preview.png)

**Desktop B — card above the composer.** Review sits next to the conversation; preview keeps the highlight. Feels like composing, but crowds the chat column.
![Desktop B](designs/desktop-B-card-above-composer.png)

**Phone A / mobile 1 — selected bottom drawer over the preview.** Element is scrolled above the drawer and stays highlighted. Recommended as a composition direction only. This isolated mock uses a bespoke sheet; production must use `CompactSecondaryPanelShelf` and the persistent responsive drawer, including keyboard/safe-area and focus behavior. The composition is selected; this mock does not implement the production drawer integration.
![Phone A](designs/mobile-A-half-sheet.png)

**Phone B — full-screen review.** Bigger crop and text box; the live page is hidden while writing (the crop is the "highlighted preview").
![Phone B](designs/mobile-B-full-review.png)

Also: selecting state ([phone](designs/mobile-0-selecting.png), [desktop](designs/desktop-0-selecting.png)), sensitive field ([phone](designs/mobile-A-sensitive-form.png)), native Electron highlight ([desktop](out/desktop-native-highlight.png)).

## 9. Production tickets (selected direction; review and integration gates still apply)

Each is one PR, UI + SDK/CLI where it applies, with tests.

1. **Shared schema + element-context module** (`packages/desktop-contract`): zod result schema, `element-context.js` as a bundled string asset, unit tests for redaction and selector stability. ~1 day.
2. **Desktop native select** (`apps/desktop`): 3 IPC channels, CDP inspect mode, isolated world, clipped capture, bitmap masking, generation + lease guard. Tests with the existing `desktop-browser-view-manager` harness. ~2 days.
3. **Send without touching the draft** (`ThreadDetailPromptArea`): separate follow-up sender using existing builders/mutations, stable retry ID, unchanged composer handlers, queue-if-active only; test local/cloud guards and v111 disk/error states. ~1 day.
4. **Review panel** (`apps/app`, only after chosen layout; persistent responsive drawer on phone): crop canvas, hide-area, remove image, chips, Parent/Child, target line, Escape, focus handling, live announcements. Storybook + tests. ~2 days.
5. **Desktop wiring**: "Select" in `BrowserChrome`, invalidation on tab navigate/close/thread switch. ~1 day.
6. **Select shell in the tunnel client** (`packages/tunnel-client`): reserved path, headers, origin pinning, shell assets, tests that it never proxies the path. ~1.5 days.
7. **Share ↔ thread link** (`plugins/connect`): thread/project/host ownership on expose/list, CLI + SDK; verified ownership is mandatory for phone Select and must survive neither host switches nor port reuse. ~0.5 day.
8. **Phone preview tab** (`apps/app` compact panel): share-backed iframe hosted on the existing compact shelf, "can't inspect" and live "Mac offline" states, Select, persistent drawer. Preserve v111 offline/Mac-switch cache invalidation and live status checks. Verify in iOS Safari and the native shell (B1, B2). ~2 days.
9. **Docs + plugin audit entries** if any SDK surface is exposed (`docs/api_to_audit.md`). ~0.5 day.

## 10. Reviews

See [REVIEWS.md](REVIEWS.md).
