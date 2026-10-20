# CR8 review and validation ledger

Status: **exact-head independent review pending**. No historical review approves the recovered remediation or the resumed checkpoint. No production implementation or design option has been approved.

## Historical reviewers

| Reviewer | Thread | Evidence available on resume | Scope / status |
| --- | --- | --- | --- |
| Sol 6.1 Medium, independent | `thr_wryafz7wsw` | Full saved final report read using `room-cli thread output` | Reported eight findings against the earlier prototype. Historical browser run 99/99; not current signoff. |
| Luna 6 High, privacy helper | `thr_jrpersmfzi` | Referenced by the historical independent review | Historical helper evidence, not independent current approval. |
| Luna 6 High, tests helper | `thr_78z8px8k65` | Referenced by the historical independent review | Historical 98/99 browser result, WebKit mismatch; Electron 44.9.1 pass. Not current validation. |
| Haiku 5.5 High, mobile | `thr_bejtzgsyxv` | Supplied conversation excerpt; read-only output endpoint returned no saved messages/reply on resume | Historical Claude evidence, honestly attributed. Excerpt is truncated after finding 9. |
| Haiku 5.5 High, routing | `thr_pdtwpmceqf` | Supplied conversation excerpt; output endpoint returned no saved messages/reply | Historical Claude evidence. Excerpt is truncated in finding 7; finding 9 is mentioned by the prior coordinator but its full text is unavailable. |
| Haiku 5.5 High, privacy | `thr_d23zsn5rvh` | Supplied conversation excerpt; output endpoint returned no saved messages/reply | Historical Claude evidence. Excerpt is truncated in finding 5. |

The supplied conversation says the initial reviewers received `b112362`; subsequent fixes at `349125b` and `8d2c7a8` were not part of that original reviewed tree. Original model verification was reported by the previous coordinator and has not been independently reverified here. Awake/asleep/idle states and thread titles do not establish provider/model settings. No Claude actor was messaged or continued during resume; no new or replacement review job was created.

## Recovered remediation: candidate fixes, not review closure

| Historical finding | Recovered prototype behavior / remaining gate |
| --- | --- |
| Nested scrolling can reveal hidden pixels | Crops intersecting a scrolled container return details only. Touch/wheel use the nearest scrollable ancestor. No claim that arbitrary scroll layouts now render faithfully. |
| Shadow DOM, embedded content and split tokens leak in native crops | Open roots traversed; closed hosts masked through CDP; embedded regions and cross-node secret ranges masked. Native fixtures exercise these cases. Arbitrary CSS/opaque-content privacy still needs adversarial review. |
| Private text/name leakage | Private-root/ancestor checks, visible text clipping and a removable element-name chip added. All private/hidden/ARIA combinations and cross-shadow ancestry remain re-review cases. |
| Debugger ownership and leaked listeners | Selector tracks ownership and removes listeners. Refusing an agent lease then calling stop preserves that lease in the native check. Full failed-start/navigation adapter integration remains a production gate. |
| Old results and stale SPA sends | Sequence checked synchronously; source verification deferred until Send; URL checked through a shell handshake. Keep asynchronous preparation/navigation races in exact-head review. |
| Phone can claim native screenshot provenance | Phone transport rejects `native` image claims and explains unavailability. Same-origin page code can still forge rendered data; this trust risk has not been accepted. |
| Page navigates the Cloudroom window | Outer iframe sandbox constrains top navigation; browser fixture verifies the host URL remains unchanged. Does not isolate the same-origin page from its shell. |
| Wrong-thread preview ownership | Mock labels foreign ownership and disables Select. Real ShareListing lacks thread/project ownership; missing or reused ownership must also disable Select in production. |
| Phone overlap, hidden actions, accessibility | Dynamic chrome measurement, sticky actions, 44px controls, candidate list, separate live region and focus return added. Tests measure 390×664 fit. Real VoiceOver, keyboard inset and native safe areas are not proved. |
| Full-document phone render stalls | Busy indication added; 5,000-element cap documented. Target-only rendering and representative phone performance remain open. |
| Mock UI does not use product drawer | Still true: standalone feasibility mock. Any chosen production layout must reuse compact shelf and persistent responsive drawer. |
| Invalid image prevents cancellation | Handlers bind before image loading; failed decode becomes details only; fixture verifies Cancel works. |
| Wrong origin, send/upload contracts, retry risk | FINDINGS.md now specifies a trusted app-origin allowlist for v111, NativeTabRef guards, separate follow-up sender, real PromptInput/multipart shapes and stable request IDs. These are proposals, not implemented product integration. |

Truncated historical reviews prevent claiming that every original finding has been dispositioned. Recovering their full reports is a review blocker; do not wake provider-locked Claude actors to recreate them.

## Resume validation

Validation uses only existing tools and dependencies. Tests run from `/tmp/cr8-codex-resume-mee_wrn5/prototype`, preserving the recovered tracked evidence in the repository. No GUI build is claimed: no `gui/` source was changed.

- First browser rerun: **161/162**. The Chromium phone live-region check read before the intentional 30ms announcement callback. The test now waits up to two seconds for the expected announcement instead of reading it immediately. No application behavior changed for this test fix.
- Final browser rerun: **162/162 passed**: 54 Chromium phone, 54 WebKit phone, 54 Chromium desktop. The pass verifies DOM live-region updates, not audible announcements on VoiceOver.
- Final browser results: `/tmp/cr8-codex-resume-mee_wrn5/prototype/out/test-results.json`; log: `/tmp/cr8-codex-resume-mee_wrn5/browser-tests-final.log`. Native results: the same scratch `out/desktop-results.json`; log: `/tmp/cr8-codex-resume-mee_wrn5/electron-tests.log`. These are local evidence, not uploaded artifacts.
- All tested JavaScript/HTML source bytes match the checkpoint candidate. The only stylesheet difference from the scratch copy is removal of one trailing empty line; no CSS rule changed during resume. `node --check` on the server, app, shell, context extractor and native script passes. `git diff --check` passes.
- Native Electron **44.3.0**: passed (`ok: true`), including click suppression, geometry, private/split/shadow/embedded masks, stale navigation, agent lease preservation and listener cleanup. This is the actual installed version used on resume, distinct from historical reviewers' versions.
- Rendered designs were recovered intact and visually inspected on resume. They illustrate design options, not production integration or user acceptance.
- No real iPhone/iOS native-shell test, deployed relay auth test, production upload/send test or exact-head independent re-review has occurred on resume.


Result file hashes (SHA-256):

- `test-results.json`: `fef3492e1f4ac1fc125452f799b4f621addb8fc0375471977155ce8fecbc79cf`.
- `desktop-results.json`: `9fa867f897ed4a83e8feb16559582e22a9fffaa2d32b162c997ac3a005589a01`.

## Next gates

1. Preserve the sole-owner checkpoint and have an independent Codex reviewer inspect its exact commit hash under the existing approved review scope, once permitted/configured. No stale signoff can substitute.
2. Recover missing historical report text without waking Claude; finish disposition of any unseen findings.
3. Present desktop A/B and phone A/B for the user's choice. Choice does not waive privacy, ownership, device or review gates.
4. Production work, publishing, deployment, merge and upstream PR remain on hold.
