# New-thread drafts

The new-thread composer keeps one unsent draft per project. Switching projects
leaves the draft with its project and shows the destination project's draft.
Nothing moves, disappears, or sends because of a switch. Cross-device sync is
out of scope.

## Storage

- Drafts live in browser `localStorage`, in the existing prompt-draft store
  (`apps/app/src/hooks/usePromptDraftStorage.ts`) and record format
  (`PromptDraftState`), with the attachment fix's attachment schema.
- Key: `bb.promptbox.contents-new-thread-<projectId>-3`, built with the store's
  `normalizeStorageSegment` (trim, then `encodeURIComponent`). `projectId` is a
  real project ID, or `proj_personal` for **No project**, its own draft.
- Other new-thread keys use the same project segment:
  `bb.promptbox.conflict-new-thread-<projectId>-<rev>-3`,
  `bb.promptbox.recovery-new-thread-<projectId>-<windowId>-3`, and
  `bb.promptbox.unreadable-new-thread-<projectId>-<backupId>-3` (legacy:
  `bb.promptbox.unreadable-draft-<backupId>-3`). Project IDs contain
  no `-`, so keys parse by exact prefix and suffix:
  `^<prefix>([^-]+)-3$`, or `^<prefix>([^-]+)-([0-9a-f]{16})-3$`.
- `rev`, `base`, `windowId`, and `backupId` are 16 lowercase hex characters. `windowId` is
  per tab, kept in `sessionStorage`.
- Identity is the browser origin plus the project ID. Each Cloudroom server has
  its own origin (`127.0.0.1:<port>`, or `<mac-handle>.cloudroom.run` on the
  phone). Project IDs are server IDs, never display names. Projects belong to
  the server, not an account.
- Unchanged: thread drafts (`bb.promptbox.contents-<projectId>-<threadId>-3`),
  plugin composer drafts, automation-edit drafts, and the recent-project picker.

### Reading a record

The existing `parsePromptDraftStorage` turns bad JSON, unknown shapes, and bad
items into an empty draft, so writes never rely on it. A new raw reader,
`readNewThreadRecord(raw)`, is the only read the write check uses. It returns
one of:

- `missing`: no key.
- `draft`: a JSON object with only known fields (`text`, `mentions`,
  `attachments`, `contexts`, `rev`, `base`), each valid, every attachment valid
  under the fix's schema.
- `sent`, `moved`, `discarded`: `{ rev, sent | moved | discarded: true }`.
  These read as empty in the composer.
- `unreadable`: anything else, including a draft with any invalid item.

`rev` and `base` are read from the raw record and written back by the store,
outside the shared draft format, which strips unknown keys. Attachment objects
round-trip with every schema field, including `projectId` and `copyToken`.
This ticket never reads `copyToken`.

## Callers

Every new-thread scope names its project:

- The root composer and `new-thread` plugin composers pass the composer's
  project.
- Fork from message writes its quote to `source.projectId`, the project it then
  opens.
- The plugin SDK's route fallback (`plugin-sdk-hooks.ts`) uses the route
  project, else the composer's resolved project.
- Report-bug and `?prompt=` append to a non-empty draft after a blank line
  instead of replacing it. An empty draft behaves as before.

## Ownership

- Approved policy (2026-10-20): verified uploads are owned by their project.
  Explicitly attached, verified uploads from the same project are allowed.
  Nothing is auto-injected into sibling threads. Cross-project copy uses only
  server-issued upload tokens, never paths. The server validates source and
  destination, keeps explicit copy intent, and never overwrites or follows a
  symlink out.
- What exists at the fix's head `0e249aad`:
  - The owner tag (`attachment.projectId`) is set by the client after a
    successful upload into that project's folder. It never reaches the server.
  - The server resolves folder-relative paths only inside the request project's
    folder, so another project's file fails there. It skips absolute and scheme
    paths. Cloud dispatch rejects absolute paths only.
  - `copyToken` is the only server-checked proof of ownership, used only by the
    copy route.
- The draft key decides which project's draft a record is. It never authorizes
  an attachment. The owner tag drives only client decisions here. A key, a
  stored filename, a path, or a successful GET is never evidence of ownership.
- Move carries only attachments whose `projectId` strictly equals the target.
  Untagged, foreign, absolute, scheme, or unverifiable references stay where
  they are, listed by file name, until discarded. The user can't assign one by
  assertion; they upload it again.
- Send from a per-project draft is blocked before any request, and before the
  fix's submit-time copy call, when a reference is absolute, uses a scheme, or
  is tagged with another project. The banner names each file. Untagged
  folder-relative references send as today, checked by the server's folder
  rule (pending decision, see Decisions).
- Per-project drafts never hold another project's tagged attachment, so the
  fix's submit-time copy call stays but is unreachable from them. This ticket
  adds no copy call and never issues or consumes tokens. Switching never copies.
- New-thread drafts never write attachments into a thread draft or another
  thread. Fork from message carries only quoted text.
- Uploads bind to the draft they started in. In-flight state, the one-upload
  guard, and upload errors are per draft key. An upload finishing after a switch
  lands in its original draft with its owner tag, the batch continues there,
  and its error shows on return.
- The keyed snapshot, per-key uploads, and the matched send clear ship together
  with the no-copy switch. The switch change never lands alone.

## Switching

- Edits reach the in-memory cache synchronously, so changing the key is the
  atomic step. The origin draft's pending write is queued with its captured key
  and content before the key changes.
- The "restore draft after option change" snapshot stores
  `{ storageKey, draft }` and restores only on a key match. A project switch
  never takes one.
- Removed together from the switch path: the copy call, the refusal to switch
  when an attachment has no copy token, the copying guard,
  `isCopyingAttachments`, and the "Moving attachments…" status.
- After a switch where either draft has content, a note says, for example,
  "Saved your Alpha draft. Showing your Beta draft." It clears after 4 seconds
  and shows once per project pair per window.
- The picker is disabled while a send is in flight, as today.
- A new tab opens the last selected project. Marking which projects hold drafts
  belongs to the picker ticket.

## Concurrent windows

Two windows can edit the same project's draft. Neither window's work is
silently overwritten. A newer write never authorizes discarding other content.

- Each `draft` record carries `rev` and `base` (the `rev` it was written over).
  Each window remembers, per key, the `rev` it last read, wrote, or adopted.
- Every write to a new-thread key takes that key's exclusive Web Lock
  (`bb.promptbox.write.<key>`). The key and content are captured before the
  request. The callback is synchronous: read, check, write, no `await`. A lock
  that rejects or doesn't arrive within 2 seconds takes the unlocked path below.
- The check reads the stored record with `readNewThreadRecord`, first match wins:
  1. `unreadable`: don't write. Show "Saved draft can't be read." Content stays
     in memory.
  2. `missing`: write.
  3. `moved` or `discarded`: don't write. Show "This draft was moved or
     discarded in another window" with **Keep my copy** (writes it) and
     **Discard**.
  4. `sent`: write, and show "This draft was sent from another window. What you
     see is your unsent copy." Nothing sends by itself.
  5. `draft`, same `rev` as this window's base: write with a new `rev`.
  6. `draft`, same content: adopt its `rev`, no write.
  7. `draft`, other content: save it as a conflict copy named by its own `rev`
     (skipped if present), then write. If the copy fails, don't write; show
     "Draft not saved on this device".
- Clearing a draft to empty is a normal write and runs the same check.
- `storage` events: a window with no pending or unsaved write adopts an
  incoming `draft` and sets its base to the incoming `rev`. If the incoming
  `base` isn't this window's `rev` and content differs, it first saves its own
  content as a conflict copy. An incoming `moved`, `discarded`, or `sent` shows
  the matching notice above and never creates a conflict copy.
- **Send clear.** The send captures `{ key, content, rev }`. On success, under
  the key's lock, it writes `sent` only if both the in-memory draft and the
  stored record still equal the captured content and `rev`. If either differs
  (typing not yet flushed, text typed or moved in, another window's write),
  nothing is cleared and the newer content stays. A pending debounced write is
  never cancelled by a send.
- **Unlocked writes** (pagehide flush, a lock timeout, or no Web Locks, as in
  Safari before 15.4) first write `{ rev, base, content }` to this tab's
  recovery key, which no other tab writes. Without Web Locks, the tab then
  writes the shared record with the check, reusing that `rev`. A recovery record
  is then in exactly one state:
  - Its `rev` is the stored `rev`: already saved. Hidden. The next checked write
    that reads that `rev` removes it.
  - Its `base` is the stored `rev`: written over the current record, as a
    pagehide flush is. It becomes the record under the lock, and its key is
    removed. No banner.
  - Otherwise: no other window saw it. It shows as a conflict copy.
- A pre-upgrade window writes the legacy global key with no `rev` and no check.
  See Legacy reappearing.

What this protects, and what it can't:

- Web Locks serialize only cooperating windows on this build. Among them, every
  check-and-write is one step, so no write silently replaces another.
- `localStorage` has no compare-and-swap. Pre-upgrade windows write the legacy
  draft key and the legacy request record with no lock and no check, and can
  replace or remove either at any moment. Nothing here prevents that. The only
  mitigations are re-reading immediately before each write, Legacy reappearing,
  and never removing on their behalf.
- Without Web Locks, recovery keys keep every tab's own content, but nothing
  serializes Move, Discard, request records, or backups. The limits are named
  in each section and under Decisions.
- Thread drafts keep today's behavior.

## Drafts not shown in the composer

A saved draft the composer can't show appears in one banner. It is never
assigned, merged, moved, or deleted without a click. Upgrade writes, copies,
and removes nothing. Rows are matched in this order, first match wins:

| Kind | How it's found | Shown in | Actions |
| --- | --- | --- | --- |
| Unreadable | Any new-thread or legacy key that reads `unreadable` | Every project | Discard, Not now |
| Legacy | Old global key `bb.promptbox.contents-draft-3`, owner unknown | Every project | Move to, Discard, Not now |
| Conflict copy | A conflict key, or a recovery record no window saw | Its project; if not in the list, the lookup rows below | Add to this draft, Discard, Not now |
| Project no longer available | Lookup returned 404 `project_not_found` or `project_unavailable` | Every project | Move to, Discard, Not now |
| Project not in your list | Lookup returned 200 (for example, hidden) | Every project | Not now. Copy: "Unsent draft in <project>, which isn't in your project list." |
| Couldn't check | Lookup failed or returned anything else | Every project | Retry, Not now |

- Discard on an unreadable record, under the key's lock, in one synchronous
  callback:
  1. Pick a fresh `backupId`. If that backup key exists, pick another. A backup
     key is written once and never overwritten or removed.
  2. Write the raw string unchanged to it, then read it back. If the write
     fails or the bytes differ, stop: no tombstone, show "Draft not saved on
     this device".
  3. Re-read the source raw. Only if it still equals the backed-up bytes, write
     `discarded`. Otherwise stop and leave it.
- This mechanism is fixed. How backups are shown or offered back is a held
  design decision. Until then backups are not scanned or shown.
- A pre-upgrade window can still replace the legacy key between step 3's
  re-read and the tombstone write. That value is lost from the legacy key. No
  cooperating window can prevent it.
- Lookup candidates are computed only after the sidebar list settles
  (successful, non-placeholder). A key is a candidate when it is non-empty, its
  project is not `proj_personal`, and it is not in that list. The scan covers
  the contents, conflict, and recovery prefixes, cache plus `localStorage`.
- Each candidate project gets one uncached `GET /api/v1/projects/:id` when it
  joins the set, then only on **Retry** or right before an action. Never on a
  keystroke or write, no automatic retry. Only the two 404 codes count as no
  longer available, and the copy never says "deleted".
- The lookup runs again right before **Move to** or **Discard** on a
  no-longer-available draft. If the answer changed, the action stops.

Typing while projects load: the text is written under the requested project's
key. If that project proves unavailable or not in the list, the composer shows
No project, and the draft stays under its original key and project ID. It is
never reassigned, its attachments never move, nothing sends, and it appears in
the banner.

**Move to <project>** and **Add to this draft**:

1. Single-flight. The target is captured at click. Disabled while the target
   draft is sending. This window's pending target write is flushed first.
2. Take the move lock (`bb.promptbox.move`), then the target's and source's
   write locks, in that order. Steps 3–5 run synchronously in the innermost
   callback.
3. Read source and target with `readNewThreadRecord`. If either is
   `unreadable`, stop and show the Unreadable row. Run the target's check
   against this window's in-memory target. Append with a new exported
   `appendPromptDraft` (plain text after a blank line, mentions shifted by the
   offset, contexts merged, attachments deduped by path), carrying only
   attachments whose `projectId` equals the target.
4. Write the target. On failure, restore the target in memory, change nothing
   else, and show "Couldn't move the draft. Nothing changed." with **Retry**.
5. Rewrite the source with what stayed behind, or write `moved` when nothing is
   left. On failure, show "Moved, but the original in <source> couldn't be
   updated. Discard it there."
6. For a legacy source, add the moved text's hash to the set in
   `bb.promptbox.legacy-moved-3`. Leftovers are written with a `rev`.

- Another window's unflushed typing in the target isn't in the move. Its later
  write saves the moved content as a conflict copy there. Nothing is lost.
- Without Web Locks, Move runs unlocked, and two windows pressing Move in the
  same instant could put the text in both targets. Nothing is lost.
- **Discard** is two-step and inline. It writes `discarded` under the same lock
  and check. Attachment files on the server are never deleted.
- **Not now** hides that banner for this window only and writes nothing.
- Leftovers show as "N attachments stayed behind", with file names. Discard
  there removes only those references.

Legacy reappearing: a legacy record with no `rev` after a Move was written by a
pre-upgrade window. The legacy row then says "Unsent draft from a window that
hasn't updated. Reload your other Cloudroom windows." Move stays available. If
the text's hash is in the moved set, the row says it was already moved.
Residual: an edited version of moved text isn't recognized.

## Cloud request evidence

A Cloud send stores `cloudroom-request:<draft key>` = `<fingerprint>:<id>`. The
fingerprint is a SHA-256 of the whole request, including the project, so a
match on any key is the same request. Old builds write and clear only the
legacy record `cloudroom-request:bb.promptbox.contents-draft-3`, unlocked: they
overwrite it on a mismatch and remove it on success (`cloudroom-queries.ts`
at `0e249aad`).

- `cloudroomRequestId` branches by key prefix. Thread sends
  (`ThreadDetailPromptArea.tsx`) keep today's behavior.
- For new-thread keys, scan and create run together under one origin lock
  (`bb.promptbox.request`), in one synchronous callback:
  1. Check by fingerprint the draft's own record, the legacy record, and every
     `cloudroom-request:bb.promptbox.contents-new-thread-*` record, including
     `:<id>` ones. On a match, reuse that ID.
  2. Otherwise issue a new ID. Write it under the own key only if that key is
     missing, else under `cloudroom-request:<draft key>:<id>`. Never overwrite
     a record.
  3. Return `{ id, fingerprint, recordKey }`.
- Without Web Locks, step 2 always writes the `:<id>` key, which no other
  window writes, so nothing is overwritten. Two windows may then each create a
  record for the same request, with different IDs, and both send. That is the
  same exposure as two windows sending today.
- A successful send, under the same lock, removes `recordKey` only if it still
  holds the used fingerprint and ID. If an old window replaced it, it stays.
- Discard, Move, and migration never add, copy, or remove records.
- Expiry, only if approved (see Decisions): new records append `:<createdAt>`
  (old builds read the first two fields). Age is checked before matching:
  records older than 24 hours are skipped and removed under the lock.
  Timestamp-free records, including every pre-upgrade and legacy record, never
  expire by age. They stay eligible for matching until a successful send
  removes them by the conditional rule above. Without approval, no record has
  an age and none expires.

## Banner UI

- Reviewed design: `apps/app/src/components/promptbox/banner/NewThreadDraftDesign.stories.tsx`
  (design only, built from `ProviderRequirementBanner`, `PromptStackCard`, and
  `Button`). New states not yet in the reviewed renders, held for design
  review: unreadable, conflict copy, not in your list, couldn't check, sent
  elsewhere, moved or discarded elsewhere, legacy reappearing, send blocked by
  an attachment, leftover file names.
- One slot above the composer shows one state, by priority: storage failure,
  send blocked, move result, sent or moved elsewhere, leftovers, drafts not
  shown. The switch note shows only when none of these do. "1 of N" steps
  through the drafts-not-shown rows.
- Move failures and couldn't-check rows offer **Retry**. Storage failure offers
  **Copy draft** (clipboard).
- Accessibility: the switch note is a polite live region; warnings use the
  existing alert role. Focus isn't moved to a banner, since it can appear while
  the user types. The slot comes before the editor in DOM order, so it is
  reachable by Tab and screen readers.

## Failures

- Storage write failure: the key is marked unsaved and the composer shows
  "Draft not saved on this device". The draft stays in memory. `storage` events
  and re-reads never replace an unsaved draft. The mark clears on the next
  successful write.
- Storage read failure never throws during render. The store falls back to
  memory.
- Project no longer available: its attachment folder may be deleted already.
  Its attachments stay in the record until discarded.
- Attachment load failure: the reference stays and can be removed. Send fails
  with the server's error and keeps the draft.

## Rollback

- Old builds read only the global key. An untouched legacy draft reappears
  after a downgrade. Every new key and marker stays in storage, ignored by old
  builds, and is back on upgrade. Text moved with **Move to** is not shown by an
  old build. Nothing is deleted.
- An old build drops `projectId` and `copyToken` on parse and saves them
  stripped on its next legacy write. Those attachments become untagged: discard
  or upload again.
- An old build's switch copy sends `{ sourceProjectId, paths }`. The fix's
  server accepts only `{ tokens }`, so it fails with a visible 400.
- Old builds read request records by their first two fields and ignore `:<id>`
  records. A record kept only under a `:<id>` key isn't found by an old build,
  so a retry after a downgrade can issue a new ID.
- Backup keys stay in storage, ignored by old builds.

## Tests

Changed:

- `usePromptDraftStorage.test.tsx`: "uses project-agnostic storage for
  new-thread prompt contents" asserted the global key. Replaced by per-project,
  No project, and legacy-untouched tests.
- `useForkThreadFromMessage.test.tsx`, `plugin-slot-mounts.test.tsx`: the
  new-thread scope names a project.
- `RootComposeView.test.ts`: `isCopyingAttachments` removed.

New: `readNewThreadRecord` kinds; field round-trip; each check step in order,
including a `moved` record never overwritten; adopt sets base; `storage`
events for each kind; send clear keeps text typed during a send (fails under a
rev-only check); recovery states and lock timeout; Move under locks with
typing in between, target flush, unreadable stop, disabled while sending, step
4 and 5 failures; `appendPromptDraft` plain text and mention offsets;
unreadable Discard keeps a backup; key parsing and the three-prefix scan;
lookup timing; the not-in-list row has no Move; untagged attachments never
carried; send blocked for absolute, scheme, and foreign references; request
lookup reuses a legacy or other-key match without overwriting, and returns its
record key; legacy reappearing.

## Contract scenarios

Reasoned from the contract and the frozen source. Not executed. Each becomes a
failing test before its code.

1. Send captures S. The user types E; success arrives before the debounce
   flushes E. Storage equals S, memory doesn't: no clear, E saves later.
2. Send captures S. Another window writes F. Memory equals S, storage
   doesn't: no clear, F stays.
3. Two windows send the same request with the own key empty, with Web Locks:
   the second finds the first's record in step 1 and reuses its ID.
4. Same without Web Locks: each writes its own `:<id>` key. Neither record is
   lost. Two IDs are issued.
5. The send reuses the legacy record's ID. An old window then overwrites the
   legacy record with its own request. The conditional clear sees another
   fingerprint and leaves it.
6. Discard of an unreadable legacy value V1 backs up V1 under a fresh key. An
   old window writes V2. A second Discard backs up V2 under another fresh key.
   V1's backup is untouched.
7. The backup write fails (quota): no tombstone, the source stays, the storage
   failure state shows.
8. Between backup and tombstone the source changes: no tombstone.
9. If expiry is approved: a 25-hour-old matching record is skipped and
   removed, so the send gets a new ID. A timestamp-free legacy record still
   matches.

The tests in the held implementation were written after its code. They are
retrospective and count only after each is shown to fail on the pre-change
code. Each new fix starts with a failing test, then the smallest passing
change, then refactoring.

## Integration with the attachment fix

The attachment fix (`fix cross-project image replay`,
`room/fix-cross-project-image-replay-yuuh`) owns path authorization, ownership,
owner tags, copy tokens, copy, replay, and containment, on the server and in
Cloud commands. No head is an integration baseline yet. The table reflects
`0e249aad` and is rechecked against its final reviewed head.

| Shared file | Attachment fix owns (kept) | This ticket owns |
| --- | --- | --- |
| `client-core/.../prompt-draft.ts` | `projectId` and `copyToken` and their schema, `getCrossProjectPromptAttachmentCopies` | new exported `appendPromptDraft`; existing helpers unchanged |
| `AttachmentPreview.tsx` | owner-aware preview source | not touched |
| `NewThreadComposer.tsx` | upload tagging, submit-time copy call | draft scope, keyed snapshot, per-key uploads, send block, banners, switch path |
| `cloudroom-queries.ts` | not touched | new-thread request lookup and clear |
| `RootComposeView.test.ts` | its new tests | removing `isCopyingAttachments` |

- Order: the fix lands first and stays intact, including its standalone
  global-draft path. This ticket rebases onto its final reviewed head and
  changes only the switch path (the call site at `NewThreadComposer.tsx:1330`
  at `0e249aad`). Nothing of the fix is removed wholesale. Until then, draft
  storage stays isolated in `usePromptDraftStorage.ts`, the banner component,
  and `appendPromptDraft`.
- Requests to the fix owner, not decided here: untagged previews get no preview
  source (`AttachmentPreview.tsx:135`); the submit call passes an explicit
  owner; tokens never expire, live in `localStorage`, and the copy route checks
  only a valid token and public projects.
- Blocking dependencies, unverified, checked on the fix's exact final candidate:
  - the server keeps rejecting folder-relative send paths outside the request
    project (server tag checks would need the tag on the wire, a protocol bump
    that is the fix's call);
  - cross-project copy accepts only server-issued tokens and checks source and
    destination;
  - absolute and scheme paths never reach a file read on Cloud dispatch or the
    local send path (the local provider's read is untraced);
  - who may call the copy route.
- The recent-project picker (`room/project-picker-recents`) stays separate.

## Decisions

Recorded:

- Concurrent windows keep conflicting work recoverable (Jake). Unlocked edits
  use recovery keys, so ordinary edits stay recoverable without Web Locks. The
  limits for other paths are listed below.
- Typing is allowed while projects load, and the draft keeps its original
  project (Jake).
- Attachment product policy approved (2026-10-20 08:20 UTC). Untagged legacy
  attachments can't be assigned by assertion. Enforcement is unverified.
- The switch path changes only after the contract gate.

Pending. Where the contract needs a working default, it says so:

- Untagged folder-relative attachments at send: allowed, as today, under the
  server's folder check. Alternative: block every reference not tagged with the
  draft's project, which refuses sends that work today (for example, images
  recalled from prompt history).
- Request record expiry. Not approved, so not applied. Proposed: 24 hours,
  checked before matching, timestamp-free records never expire. Without it, an
  identical later send can return the earlier thread.
- How unreadable backups are shown or offered back (design-held). The backup
  mechanism itself is fixed.
- Without Web Locks: duplicate request IDs from two windows sending at once,
  and an unlocked Discard or Move racing another window.
- Pre-upgrade windows can replace or remove the legacy draft and legacy request
  record at any time. Accepting that residual, or forcing old windows to
  reload, is open.
- Coordinator sign-off on removing the switch copy path (product behavior
  already approved).
- Product sign-off that, without Web Locks, two windows pressing Move at the
  same instant may put the text in two projects. Nothing is lost.
- Acceptance that marking which projects hold drafts stays with the picker
  ticket.
