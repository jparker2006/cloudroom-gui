# CR8 — Select and refine: findings

Status: feasibility done, **waiting for your design choice**. Nothing here changes `gui/` or ships UI.

## 1. Revisions inspected

| Repo | Ref | Commit | Notes |
| --- | --- | --- | --- |
| jparker2006/cloudroom-gui (origin) | `main` | `15cc574c8ff29788b7556f7d26bbddf670479b71` | "Publish GUI source for v109". This branch starts here. |
| davidondrej/cloudroom-gui (upstream) | `main` | `5f7a5f9ef553149d28347c696a209aa8fcd84166` | v110 + Windows saved-connection fix, 2026-10-19. 212 files differ from origin. |

Paths below are relative to `gui/` and refer to origin unless marked upstream.

## 2. Known constraints — verified

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Desktop browser uses Electron `WebContentsView` with native capture and CDP | **True** | `apps/desktop/src/desktop-browser-view.ts`, `desktop-browser-cdp.ts`, `desktop-browser-cdp-adapter.ts` (debugger attach/ownership) |
| Existing capture is full-viewport, not a privacy-safe crop | **True** | `captureTab` (`desktop-browser-view.ts:991`) → `captureDesktopBrowserPage` (`desktop-browser-capture.ts:71`): whole page, resized to max size, JPEG. Exposed via `captureTab` route (`packages/server-contract/src/public-api.ts:734`) and `bb browser`. No clip, no masking. |
| Sandboxed HTML previews lack a DOM bridge | **True** | No bridge in app; web/phone build shows "Browser tabs need the desktop app" (`apps/app/src/components/secondary-panel/BrowserTabContent.tsx:314`). |
| Upstream `experimental_page` evaluate/onMessage declared but unsupported | **True, upstream only** | Declared at upstream `packages/plugin-sdk/src/app-contract.ts:314`; app passes `UNSUPPORTED_BROWSER_PAGE` that rejects (upstream `apps/app/src/components/plugin/PluginBrowserToolbarActions.tsx:49`). **Not present at all in origin v109.** |
| Thread sharing exports conversation text | True | `apps/app/src/components/SharedThreadOpener.tsx`; not a live-app channel. Not used. |
| Connect port shares provide live app access | True, **on a separate origin** | `https://<handle>--<port>.cloudroom.run` vs app `https://<handle>.cloudroom.run` (`apps/connect/src/worker.ts`, `apps/app/src/cloud/cloud-mode.ts:2`). Same site (cloudroom.run is not on the Public Suffix List today), different origin → the app cannot read the share's DOM or pixels. |

Additional facts that shape the design:

- **Phone has no in-app preview today.** Phones open share URLs as browser links.
- **Shares are host+port, not thread.** `ShareListing` (`plugins/connect/src/types.ts`) has no thread or project. Two threads on one Mac can both "own" port 3000 over time.
- **The relay 404s every `/__*` path on share hosts** (`apps/connect/src/worker.ts:457`), but forwards everything else to the host's tunnel client (`packages/tunnel-client/src/session.ts:271 executeHttp`). The tunnel client is public code in this repo.
- **Share session cookie is `SameSite=Lax`** (`worker.ts:209`), so a same-site iframe gets it.
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
| Relay `cloudroom.run` | `apps/connect` (Cloudflare Worker, deployed by David only) | Repo-public, deploy-private | **No change needed** for the proposed path. |
| Website / accounts `cloudroom.dev` | Private | Private | No change needed. |
| Native iOS/Android shell | Private | Private | No change needed. Optional later: native capture capability. |
| Plugin `experimental_page` (upstream) | `packages/plugin-sdk` | Public | Not used. Could later be backed by the same desktop isolated-world code. |

## 4. What the prototype proves

Hardest path first: phone. Then desktop.

**Phone (select shell, `shell/`):** the Cloudroom app embeds the share origin's shell; the shell embeds the app at the same origin and owns a transparent tap catcher. Taps never reach the page, drags scroll it, a tap picks one element, the highlight is drawn outside the page DOM, context is extracted with `shared/element-context.js`, and a crop is rendered locally from the DOM with sensitive areas burned in before anything leaves the shell. The app validates, re-redacts, shows review, and only uploads on Send.

**Desktop (real Electron 44, `desktop/electron-select.cjs`):** CDP `Overlay.setInspectMode(searchForNode)` on the tab's `WebContentsView`. The click is consumed by the inspector. Context runs in a CDP isolated world (page scripts can't tamper with it). `Page.captureScreenshot` with `clip` gives a native crop; masks are burned into the bitmap in the main process.

Results (`out/test-results.json`, `out/desktop-results.json`):

| Check | chromium-phone (touch) | webkit-phone (touch) | chromium-desktop | Electron 44 |
| --- | --- | --- | --- | --- |
| Tap/click never reaches page (clicks, pointerdown, touchstart, links, inline handlers) | ✅ | ✅ | ✅ | ✅ (0 clicks, 0 pointerdowns) |
| Highlight matches element (≤1px) | ✅ | ✅ | ✅ | ✅ exact rect |
| Crop vs real screenshot of same region | ✅ ~7% px differ (outline+AA) | ✅ ~6% | ✅ ~6% | native pixels |
| Drag/wheel scrolls in selection mode | ✅ | ✅ | ✅ | n/a |
| Password, card, email, form values masked in pixels; none in text | ✅ | ✅ | ✅ | ✅ |
| Hidden inputs, secret-like text never sent | ✅ | ✅ | ✅ | ✅ |
| Prompt-injection text sent only as quoted "page data, not instructions" | ✅ | ✅ | ✅ | — |
| Source hint only when found in the project | ✅ (bad path dropped) | ✅ | ✅ | candidate returned |
| SPA nav / reload / thread switch invalidate selection | ✅ | ✅ | ✅ | ✅ navigation |
| Late result from older page rejected | ✅ | ✅ | ✅ | ✅ |
| Page-forged bridge messages: no injection, re-redacted, no send | ✅ | ✅ | ✅ | n/a (isolated world) |
| Selection refused while an agent holds the debugger | — | — | — | ✅ |
| Running thread → queued, never steered; idle → sent; queue drains | ✅ | ✅ | ✅ | — |
| Existing composer draft untouched | ✅ | ✅ | ✅ | — |
| Cancel / remove image / manual hide area | ✅ | ✅ | ✅ | — |
| Keyboard: Tab, Enter, Escape | ✅ | ✅ | ✅ | — |
| Preview that forbids framing → explained, Select disabled | ✅ | ✅ | ✅ | — |
| Shell refuses to be framed by other sites | ✅ | ✅ | ✅ | — |

99/99 browser checks and the Electron run pass in this sandbox. Two real bugs were found and fixed on the way: WebKit ignores SVG `viewBox` offsets for `foreignObject` (crop showed the wrong area), and WebKit's `-webkit-standard` font rendered as serif.

Evidence: `out/` (crops, uploaded images, highlight), `designs/` (renders below).

## 5. Smallest contracts

### 5a. Phone: select shell on the share origin (no relay change)

- **Where:** `packages/tunnel-client` `executeHttp`, before proxying: `GET /.well-known/cloudroom/select/*` is answered by the host, never forwarded to the user's server. Must not start with `/__` (relay blocks it).
- **Headers:** `Content-Security-Policy: frame-ancestors <server public origin>; script-src 'self'; ...`, `Cache-Control: no-store` (relay won't cache), `Referrer-Policy: no-referrer`.
- **App origin pinning:** the shell posts only to the server's public origin, which the tunnel client already knows (`publicOrigin`). Never read it from the URL.
- **Messages** (`cr8: 1`, all JSON, ≤4 MB):
  - app → shell: `hello {previewId}`, `select:start {nonce}`, `select:cancel`, `select:step {parent|child}`, `select:reveal {bottomInset}`
  - shell → app: `navigated {generation, path}`, `unavailable {reason}`, `select:result {nonce, seq, generation, element, crop}`, `select:ended`
- **App rule:** accept only `origin === shareOrigin && source === shell iframe && previewId && nonce && generation` match; schema-validate; PNG data URL only; re-redact strings; render as text; never auto-send.

### 5b. Desktop: three IPC channels

`bb-desktop:browser:select-start {tabId}` / `select-cancel {tabId}` / event `select-result {tabId, generation, element, crop{png, area, masks}}`. Main process: refuse if `debugger.isAttached()` (agent lease); bump generation on `did-start-navigation`, `did-navigate-in-page`, `render-process-gone`; detach on finish. Reuse `shared/element-context.js` verbatim in the isolated world.

### 5c. Shared result schema

One zod schema in `packages/desktop-contract` used by both paths: `{ element: {tag, role, name≤120, text≤200, selector≤300, path, rect, viewport, style{6}, sourceCandidate?}, crop: {kind: "native"|"rendered"|"unavailable", png?, target, scale, masks[]} }`.

### 5d. App send

Factor the queue/send half of `handleSend` into `sendThreadInput(input)` that never touches `promptDraft`. CR8 calls it with `mode` fixed to queue-if-active (local: queue when active; cloud: `queue-if-active`). Image goes through the existing `useUploadPromptAttachment` only after Send.

### 5e. Share ↔ thread

Add optional `threadId` to `connect expose` / `ShareListing` when exposed from a thread. The phone preview lists the current thread's shares first and labels others "from another thread". Without it, the app cannot prove which project a port serves.

## 6. Blockers and open risks

| # | Item | Type | Needed before production? |
| --- | --- | --- | --- |
| B1 | **Real iPhone check of the iframe share session.** The share cookie is `SameSite=Lax` and same-site, so it should flow in the iframe, including the first `/__share` → `/__pair` hop. Unverified on iOS Safari and the native shell's WKWebView. | Verification | Yes. Can't be done in this sandbox. |
| B2 | **iOS canvas rasterization of foreignObject.** Playwright WebKit (Linux) works; iOS Safari may taint or differ. If it fails, the shell already falls back to "No image, details only". | Verification | Yes. |
| B3 | If `cloudroom.run` is ever added to the Public Suffix List, handles become separate sites and Safari will block the iframe cookie. | Decision (David) | Note only. |
| B4 | Mac-off phone mode (`cloudroom.dev`) is cross-site to `cloudroom.run`; previews need the Mac anyway. Show "Preview needs your Mac online". | UX | Covered. |
| B5 | **The shell is same-origin with the user's app**, so the app's own scripts can spoof what the review shows (tested: contained, no injection, no send). Unavoidable on the web. Desktop path is not affected. | Accepted risk | Needs your OK. |
| B6 | `ShareListing` has no thread link (5e). | Small public change | Yes, for wrong-project prevention. |

No private backend, relay, website, or native-shell change is required for the proposed path.

## 7. Limitations

- Phone crop is **rendered from the DOM**, labeled "Rendered · may differ slightly". Lost: cross-origin images, `<canvas>`, video, iframes, pseudo-elements' generated content in some cases, web fonts not inlined, `position: fixed` offsets while scrolled. Real pixels need a native capture capability (private shell) — not proposed now.
- Apps that send `X-Frame-Options: DENY` or `frame-ancestors 'none'` can't be inspected on phone. The prototype says so and disables Select. Desktop is unaffected.
- Only the top document. Elements inside nested iframes select the iframe.
- React source hints come from `data-inspector-*` attributes or React ≤18 `_debugSource`. In the desktop isolated world, React fiber expandos aren't visible; only attributes work there. Hints are sent only if the file exists in the project.
- Secret detection is pattern-based (keys, JWTs, long tokens, emails, card numbers). It over-redacts rather than under-redacts. Users can hide more areas or remove the image.
- Selection is one element; "Parent/Child" refines it.

## 8. Design options

Interaction is the approved one in all options: Select → one element → highlighted preview beside an editable request → explicit Send/Queue through the thread's queue. Target project › thread is always shown. Draft untouched.

**Desktop A — docked under the preview.** Review sits under the live preview it refers to. Chat stays readable. Recommended.
![Desktop A](designs/desktop-A-docked-in-preview.png)

**Desktop B — card above the composer.** Review sits next to the conversation; preview keeps the highlight. Feels like composing, but crowds the chat column.
![Desktop B](designs/desktop-B-card-above-composer.png)

**Phone A — half sheet over the preview.** Element is scrolled above the sheet and stays highlighted. Recommended.
![Phone A](designs/mobile-A-half-sheet.png)

**Phone B — full-screen review.** Bigger crop and text box; the live page is hidden while writing (the crop is the "highlighted preview").
![Phone B](designs/mobile-B-full-review.png)

Also: selecting state ([phone](designs/mobile-0-selecting.png), [desktop](designs/desktop-0-selecting.png)), sensitive field ([phone](designs/mobile-A-sensitive-form.png)), native Electron highlight ([desktop](out/desktop-native-highlight.png)).

## 9. Implementation tickets (after your choice)

Each is one PR, UI + SDK/CLI where it applies, with tests.

1. **Shared schema + element-context module** (`packages/desktop-contract`): zod result schema, `element-context.js` as a bundled string asset, unit tests for redaction and selector stability. ~1 day.
2. **Desktop native select** (`apps/desktop`): 3 IPC channels, CDP inspect mode, isolated world, clipped capture, bitmap masking, generation + lease guard. Tests with the existing `desktop-browser-view-manager` harness. ~2 days.
3. **Send without touching the draft** (`ThreadDetailPromptArea`): extract `sendThreadInput`, queue-if-active only, tests for local and cloud queue paths. ~1 day.
4. **Review panel** (`apps/app`, chosen layout): crop canvas, hide-area, remove image, chips, Parent/Child, target line, Escape, focus handling, live announcements. Storybook + tests. ~2 days.
5. **Desktop wiring**: "Select" in `BrowserChrome`, invalidation on tab navigate/close/thread switch. ~1 day.
6. **Select shell in the tunnel client** (`packages/tunnel-client`): reserved path, headers, origin pinning, shell assets, tests that it never proxies the path. ~1.5 days.
7. **Share ↔ thread link** (`plugins/connect`): optional `threadId` on expose/list, CLI + SDK. ~0.5 day.
8. **Phone preview tab** (`apps/app` compact panel): share-backed iframe, "can't inspect" and "Mac offline" states, Select, sheet. Verify in iOS Safari and the native shell (B1, B2). ~2 days.
9. **Docs + plugin audit entries** if any SDK surface is exposed (`docs/api_to_audit.md`). ~0.5 day.

## 10. Reviews

See [REVIEWS.md](REVIEWS.md).
