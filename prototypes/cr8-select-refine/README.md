# CR8 select-and-refine — feasibility prototype

Isolated prototype. It does not touch `gui/`. No project dependencies; Node 22+ only.
Tests and design renders need Playwright (a tool, not a project dependency).

Findings, source map, contract, design options and tickets: [FINDINGS.md](FINDINGS.md).
Recovered upstream comparison: [RECONCILIATION.md](RECONCILIATION.md). Review status and validation: [REVIEWS.md](REVIEWS.md).
Selected: desktop 1 docked under the preview; mobile 1 bottom drawer with clipping corrected. See [morning selection and evidence](MORNING-SELECTION.md). Production integration and shipping remain gated.

## What runs

`node server.mjs` starts three origins on loopback:

| Port | Plays the part of | Notes |
| --- | --- | --- |
| 4300 | The user's app being built | Pricing page with a login form, password, card field, hidden CSRF input, an API key in page text, a prompt-injection paragraph, SPA and full navigation links. |
| 4301 | A Connect port share (`<handle>--4300.cloudroom.run`) | Proxies to 4300 like the tunnel client does, and serves the **select shell** at `/.well-known/cloudroom/select/`. |
| 4302 | The Cloudroom app (`app.<base>` in upstream v111; legacy `<handle>.<base>`) | Thread view, composer with an existing draft, queue, preview panel, review panel. Mock API for attachments, messages (queue-if-active only) and source verification. |

Open `http://localhost:4302/` (desktop layout) or the same URL in a phone-sized window with `?tab=preview`.
`?layout=b` retains historical option B; A is selected.

## Commands

```sh
node server.mjs
CR8_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/run.mjs            # current counts in REVIEWS.md; chromium-phone, webkit-phone, chromium-desktop
CR8_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/selected-layout.mjs # selected-layout and reading-position regressions
CR8_PLAYWRIGHT=/path/to/playwright/index.mjs CR8_DESIGNS=desktop-A-docked-in-preview,mobile-A-half-sheet,mobile-A-sensitive-form node tests/render-designs.mjs # selected renders only
electron --no-sandbox desktop/electron-select.cjs                          # native desktop path, needs a display (Xvfb)
```

## Files

- `shared/element-context.js` — sanitized element description and sensitive-area finder. Used by the phone shell and, unchanged, in the Electron isolated world.
- `shell/` — the select shell: wraps the app in a same-origin iframe, owns the tap catcher, highlight, keyboard picking, and the rendered crop.
- `room/` — Cloudroom mock: validation of bridge messages, review, redaction, send through queue-if-active.
- `desktop/electron-select.cjs` — Electron 44 `WebContentsView` + `webContents.debugger`: CDP inspect mode, native clipped capture, pixel redaction, stale and lease checks.
- `tests/run.mjs` — end-to-end checks. `out/` holds evidence images.
