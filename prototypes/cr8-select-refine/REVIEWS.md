# CR8 review and validation ledger

Status: **CHANGESREQUESTED on `bc517215403a47b7b5fc1d4ca2e8d68e52d12a1e`; follow-up candidate requires a fresh exact-head independent review**. Desktop 1 and mobile 1 are now selected; see [morning selection and new validation](MORNING-SELECTION.md). Selection does not approve production integration or shipping. The ledger below preserves the earlier resume and historical reviews; none approves the changed morning candidate.

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


## Selected morning candidate

Desktop 1 under-preview dock and mobile 1 bottom drawer are selected. [MORNING-SELECTION.md](MORNING-SELECTION.md) preserves both human source anchors, exact preflight, public guidance reads, changed files, red/green chronology and final result hashes. Final selected regressions pass **43/43**; final retrospective existing checks pass **162/162**. Replaying the exact final selected test on unchanged `0e346e6` gives **10/43**, providing retrospective sensitivity evidence. These checks do not replace independent exact-final-head review or close physical device, signed-in access, privacy, performance, accessibility, source-anchor or product integration gates. Root owns review reconciliation; no helpers/reviewers were awakened.


## Exact-head review follow-up: send ownership and composed privacy

The independent Sol 6.1 Medium completion for `bc517215403a47b7b5fc1d4ca2e8d68e52d12a1e` requested changes: a canceled send uploaded the replacement selection's image, and a private shadow host's label leaked into the queued text. Its 43/43 layout result and 8/9 focus mutant are historical independent evidence for that reviewed head only. The full private report path is not present in this owner's workspace; the completion was also read through the read-only child output command. No reviewer/helper was awakened or replaced.

Preflight matched the reviewed HEAD and tree `5201ac6bd2c9ab1d86c86b0fcc279b81af1a441e`, with zero dirty files and the empty-diff SHA-256. All source changes remain inside the same isolated prototype and branch. No product UI/integration, layout direction, production queue, credentials, dependencies or security permissions changed.

### User-path red → green → refactor

- Added `tests/review-regressions.mjs` before application edits. On unchanged reviewed application bytes, final baseline **3/21** passed: the three unchanged-send controls passed; all 18 cancellation/late-acknowledgment/composed-privacy assertions failed across Chromium phone, WebKit phone and Chromium desktop. Initial fixture-pointer setup timeouts were excluded from defect evidence and corrected before the completed baseline.
- The source-verification and blob-export scenarios pause those actual asynchronous operations, cancel, select another element without sending it, then release the old operation. Baseline evidence shows an upload despite zero queued/messages. Final behavior must leave uploads and messages at zero and preserve the replacement review.
- A related pre-fix user-path test shows a late acknowledgment for an already authorized request clearing the replacement draft (`draft: null`). Final behavior retains the unsent replacement draft and only the originally authorized queued request. An already submitted request is not claimed to be retractable.
- Private-host, nested-redacted-host and private-slot scenarios select a real button through the picker, inspect review text, explicitly queue, then inspect queued text and a crop pixel. Baseline slot pixels were `[239,239,239,255]`; final mask pixels must be `[17,17,17,255]`. Confidential test labels must be absent from review/queued text and replaced with `[private]`.
- Fix: export/draw/build the request from the captured selection. Check selection identity, nonce, thread/project and preview identity/generation after asynchronous work and before upload/message side effects. Stale image loads cannot populate a replacement selection. Late send acknowledgment updates history without clearing a newer review.
- Fix: ancestry follows assigned slots and shadow hosts for private markers and excluded text. A composed-private selected target gets a conservative mask if existing masks do not already cover it, including a private slot whose own rectangle is empty.
- First green was **21/21**. Refactor reused the ownership guard for initial validation and made the error text distinguish an unsent change request from any attachment upload already begun. Final outcomes and hashes are recorded below.

These are bounded candidate fixes, not independent closure. Cancellation before upload initiation now prevents that upload in the tested paths. Bytes or requests already transmitted cannot be recalled; no rollback guarantee is made. General malicious-page privacy, closed/opaque content, live navigation races, real source resolution and all prior device/auth/performance/accessibility/integration gates remain held.

### Final browser validation

| Run | Pass / total | Result JSON SHA-256 |
| --- | --- | --- |
| Pre-fix user paths on unchanged bc51721 | 3/21 | `639e0ebf9ffc304b8f6ee923f69a1712a25725957755779d21759b5978c9df5e` |
| Final review regressions | 21/21 | `495e27aed72f7a4fb25e03895cf990e69e88992875b9a9c2eedd536bff6e5554` |
| Selected layouts / return paths | 43/43 | `8cb63e222a82c73f49730a0da4dcb0cb88d6735d8bee8423d5e2dd596dc6b227` |
| Existing retrospective suite | 162/162 | `a650e6b749ad0360ab1025daa015068c589a3938c1a1d10291e4c2ac5048812e` |

Syntax checks on both changed runtime modules and the new runner, plus `git diff --check`, pass. Changed files: `room/app.js`, `shared/element-context.js`, `tests/review-regressions.mjs`, `README.md`, `REVIEWS.md`, `MORNING-SELECTION.md`. `gui/`, selected A layouts/images, history/queues outside the mock, and unrelated artifacts remain unchanged.

### Native validation limitation

The existing Electron 44.3.0 check was attempted from a scratch copy with its sandbox enabled and no bypass flag. Startup aborted with exit 133 before the check executed: the existing `chrome-sandbox` helper is not owned by root with mode 4755. Its ownership/mode were not altered; no alternate security setting, OS install, capture grant or Mac access was attempted. Copied historical native results are not counted as a new pass. `/home/cloudroom-agent/.agents/skills/cloud-computer-use/SKILL.md` (declared name `cloud-computer-use`, no declared version) was read for existing native-display guidance. Native validation of the changed shared extractor remains an explicit open gate.

Local evidence: `/tmp/cr8-review-fixes/red-complete/results.json`, `/tmp/cr8-review-fixes/final/results.json`, `/tmp/cr8-review-fixes/selected/results.json`, `/tmp/cr8-review-fixes/retrospective/out/test-results.json`; native startup log `/tmp/cr8-review-fixes-native.log`. The tracked preexisting evidence images were not overwritten.

The follow-up checkpoint is for root's exact-head independent review reconciliation only. No old signoff, automatic PR, merge, release or deployment is authorized by these tests. Effective Codex model/effort/tier metadata remains unexposed; no protected raw configuration/session files were read. The earlier direct-controller delivery was denied by thread scope; that route is not retried or bypassed.
