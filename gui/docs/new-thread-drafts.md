# New-thread drafts

The new-thread composer keeps one unsent draft per project. Switching projects
leaves the draft with its project and shows the destination project's draft.
Nothing moves, disappears, or sends because of a switch. Cross-device sync is
out of scope.

## Storage

- Drafts live in browser `localStorage`, in the existing prompt-draft store
  (`apps/app/src/hooks/usePromptDraftStorage.ts`) and its existing record format
  (`PromptDraftState`), parsed with the attachment fix's schema. New-thread
  records also carry `rev` and `base` (see Concurrent windows). These live
  outside the shared draft format: `promptDraftStorageSchema` strips unknown
  keys and `serializePromptDraftStorage` writes only the four draft fields, so
  the store reads `rev`/`base` from the raw parsed record and adds them back
  when writing. A round-trip test covers this.
- Attachment objects round-trip whole, including the fix's `projectId` and
  `copyToken`, through parse, serialize, restore, Move, and leftover rewrites.
  This ticket never reads `copyToken`.
- `rev`, `base`, and window IDs are 16 lowercase hex characters.
- Key: `bb.promptbox.contents-new-thread-<projectId>-3`, built with the store's
  existing `normalizeStorageSegment` (trim, then `encodeURIComponent`). Project
  IDs contain no `-`, so keys parse by exact prefix and suffix:
  `^<prefix>([^-]+)-3$`, and `^<prefix>([^-]+)-([0-9a-f]{16})-3$` for conflict
  and recovery keys.
- `projectId` is the composer's project: a real project ID, or `proj_personal`
  for **No project**. No project is its own draft.
- Identity is the browser origin plus the project ID. Each Cloudroom server has
  its own origin (`127.0.0.1:<port>`, or `<mac-handle>.cloudroom.run` on the
  phone), and project IDs are random server IDs, never display names. Projects
  belong to the server, not to an account, so switching accounts does not
  change which draft a project shows.
- Empty means a missing key, a sent marker, or a tombstone. Any other value
  that can't be read (bad JSON, an unknown shape, or an attachment item that
  fails the schema) is unreadable. An unreadable record is never overwritten or
  removed, and a rewrite refuses if any item would be dropped. It shows as
  "Unreadable saved draft" with **Discard** only.
- Unchanged: thread drafts (`bb.promptbox.contents-<projectId>-<threadId>-3`),
  plugin composer drafts, automation-edit drafts, and the recent-project picker.

## Callers

Every new-thread scope names its project:

- The root composer and plugin composers that use the `new-thread` kind pass the
  composer's project.
- Fork from message writes its quote to `source.projectId`, the project it then
  opens.
- The plugin SDK's route fallback (`plugin-sdk-hooks.ts`, no composer host) uses
  the route project, else the composer's resolved project, so it writes the
  draft the composer shows.
- Report-bug and `?prompt=` no longer replace an unsent draft. If the visible
  draft has content, the prompt is appended after a blank line. An empty draft
  behaves as before.

## Ownership

- The draft key decides which project's draft a record is. It never authorizes
  an attachment.
- Approved policy (2026-10-20): verified uploads are owned by their project.
  Explicitly attached, verified uploads from the same project are allowed.
  Nothing is auto-injected into sibling threads. Cross-project copy uses only
  server-issued upload tokens, never paths, and the server validates source and
  destination, keeps explicit copy intent, and never overwrites or follows a
  symlink out.
- What exists at the fix's head `0e249aad`: the owner tag (`attachment.projectId`)
  is set by the client after a successful upload into that project's folder. The
  server never sees it. Send is checked by folder: the server resolves each path
  only inside the request project's folder, so another project's file fails
  there. `copyToken` is the only server-checked proof of ownership, used only by
  the copy route.
- In this ticket, the owner tag only drives client decisions: what Move carries
  and what send allows. A draft key, a unique stored filename, a path, or a
  successful GET is never evidence of ownership.
- Untagged, foreign-tagged, absolute, scheme, or otherwise unverifiable
  references are never carried into another record, and the user can't assign
  one to a project by assertion. They stay where they are, listed by file name,
  until discarded. To use the file elsewhere, the user uploads it again.
- Send from a per-project draft is blocked, before any request, when any
  reference is absolute, uses a scheme, or has `projectId` not exactly equal to
  the draft's project (untagged included). The banner names each file, with
  re-upload or remove. New uploads are always tagged, so this mostly affects
  attachments recalled from prompt history, which used to send untagged.
- This ticket never calls the copy route and never issues, reads, or consumes
  upload tokens. Tokens are kept opaque and unchanged. Switching projects does
  not copy attachment files.
- New-thread drafts never write attachments into a thread draft or another
  thread. Fork from message carries only its quoted text.
- Uploads bind to the draft they started in. In-flight state, the "one upload at
  a time" guard, and upload errors are tracked per draft key. An upload that
  finishes after a switch is added to its original draft with its owner tag, the
  rest of the batch continues there, and its error shows when the user returns.
  Nothing is dropped, and the file is never added to the visible draft by
  mistake.
- Send clears only the captured sending draft, through the Concurrent windows
  check (see sent marker). Switching stays blocked while a send is in flight.
  Queue and send are otherwise unchanged.
- The keyed snapshot, per-key uploads, and captured-draft clear ship together
  with the no-copy switch. The switch change never lands alone.

## Switching

- Edits reach the in-memory cache synchronously, so changing the key is the
  atomic step. The origin draft's pending debounced write is flushed at the
  switch.
- The "restore draft after option change" snapshot stores
  `{ storageKey, draft }` and restores only when the key still matches. A project
  switch never takes a snapshot.
- Removed together from the switch path: the copy call, the refusal to switch
  when an attachment has no copy token, the copying in-flight guard,
  `isCopyingAttachments`, and the "Moving attachments…" status.
- After a switch where either draft has content, the composer shows a short
  note, for example "Saved your Alpha draft. Showing your Beta draft." It clears
  after 4 seconds and shows once per project pair per window.
- The project picker is disabled while a send is in flight, as today.
- A new tab opens the last selected project (the tab-scoped selection falls back
  to `localStorage`). Marking which projects hold drafts belongs to the picker,
  which this ticket doesn't touch.

## Concurrent windows

Two windows can edit the same project's draft. Neither window's work is
silently overwritten. A newer write never authorizes discarding other content.

- Each stored new-thread record carries a `rev` and `base`, the `rev` it was
  written over (old builds ignore both). Each window remembers, per key, the
  `rev` its content is based on: the one it last read, wrote, or adopted.
- Every write to a new-thread key (typing, flush, send marker, Move, Discard,
  removal) takes that key's exclusive Web Lock (`bb.promptbox.write.<key>`), so
  the check below and the write are one step across windows.
- Inside the lock, a window re-reads the stored record:
  - Same `rev` as its base: write with a new `rev`.
  - Different `rev`, same content as this window's: adopt it, no copy.
  - Different `rev`, stored record empty: write.
  - Different `rev`, stored record is a sent marker: write and show "This draft
    was sent from another window. What you see is your unsent copy." Nothing
    sends by itself.
  - Different `rev`, stored record is a tombstone: don't write. Keep the
    content in memory and show "This draft was moved or discarded in another
    window" with **Keep my copy** (writes it) and **Discard**.
  - Different `rev`, different non-empty content: first save the stored record
    as a **conflict copy** under
    `bb.promptbox.conflict-new-thread-<projectId>-<rev>-3`, where `<rev>` is
    the saved content's own `rev` (skipped if it already exists), then write.
  - Stored record unreadable: don't write. Keep the content in memory and show
    "Draft not saved on this device".
- If the conflict copy can't be saved, the stored record is not overwritten.
  This window keeps its content in memory and shows "Draft not saved on this
  device".
- A `storage` event replaces a window's draft only when that window has no
  pending or unsaved write. Adopting sets the window's base to the incoming
  `rev`. If the incoming `base` isn't this window's `rev` and its content
  differs, the other window wrote over content it never saw, so this window
  first saves its own content as a conflict copy named by its own `rev`.
- A successful send writes a sent marker (`{ "rev": "...", "sent": true }`,
  read as empty). Move and Discard removal write a tombstone
  (`{ "rev": "...", "moved": true }` or `"discarded": true`, read as empty).
  Neither removes the key.
- **Unlocked writes.** The pagehide flush can't wait for a lock, and browsers
  without Web Locks (Safari before 15.4) have none. An unlocked write never
  writes the shared record directly. It writes this window's content to its own
  recovery key, `bb.promptbox.recovery-new-thread-<projectId>-<windowId>-3`,
  which no other window writes. Without Web Locks, the window then also writes
  the shared record with the check above.
  - A recovery record holds `rev`, `base`, and content.
  - A checked write that read `rev` R removes recovery keys holding R, because
    their content is now in the record it read.
  - On load and before each checked write, a recovery record whose `base` is
    the stored `rev` was written over the current record, as a pagehide flush
    is. It becomes the record under the lock, and its key is removed. No banner.
  - Any other recovery record whose `rev` isn't the stored `rev` holds content
    no other window saw. It shows as a conflict copy.
  - So no unlocked write can erase content, even if its window closes.
- A window still running a pre-upgrade build writes the legacy global key with
  no `rev` and no check. See Legacy reappearing below.
- Thread drafts keep today's behavior. This rule covers new-thread drafts only.

## Drafts not shown in the composer

A saved draft the composer can't show as the visible project's draft appears in
a banner. It is never assigned, merged, moved, or deleted without a click.
Upgrade writes, copies, and removes nothing.

| Kind | How it's found | Shown in | Actions |
| --- | --- | --- | --- |
| Legacy | Old global key `bb.promptbox.contents-draft-3`. Owner unknown. | Every project | Move to, Discard, Not now |
| Conflict copy | A conflict or recovery key | Its project; if that project isn't in the list, the row follows its lookup below | Add to this draft, Discard, Not now |
| Project no longer available | Lookup returned 404 `project_not_found` or `project_unavailable` | Every project | Move to, Discard, Not now |
| Project not in your list | Lookup returned 200 (for example, a hidden project) | Every project | Not now only. Copy: "Unsent draft in <project>, which isn't in your project list." Nothing can move it. |
| Couldn't check | Lookup failed or returned anything else | Every project | Retry, Not now |
| Unreadable | A new-thread key that can't be read (see Storage) | Every project | Discard, Not now |

With more than one row, the banner shows "1 of N" and steps through them.

Lookup:

- Candidates are computed only after the sidebar list settles (successful,
  non-placeholder). A key is a candidate when its record is non-empty, its
  project is not `proj_personal`, and it is not in that list. Detection scans
  this store's keys (cache plus `localStorage`) under
  `bb.promptbox.contents-new-thread-`, `bb.promptbox.conflict-new-thread-`, and
  `bb.promptbox.recovery-new-thread-`.
- Each candidate project is checked with `GET /api/v1/projects/:id`, uncached. A
  lookup runs when a project joins the candidate set, never on a keystroke or
  write, and again only on **Retry** or right before an action. There is no
  automatic retry. Only the two 404 codes above count as no longer available,
  and the copy says "no longer available", never "deleted". Errors, timeouts,
  and other statuses are "couldn't check".
- The lookup runs again right before **Move to** or **Discard** on a
  no-longer-available draft. If the answer changed, the action stops.

Typing while projects load:

- The user can type while the project list loads. The text is written under the
  requested project's key. If that project then proves unavailable or not in the
  list, the composer shows No project, and the typed draft stays under its
  original key with its original project ID. It is never reassigned, its
  attachments never move, and nothing sends. It appears in the banner above.

**Move to <project>** and **Add to this draft**:

1. Single-flight. The target project is captured at click. The target's pending
   debounced write is flushed first.
2. Take the move lock (`bb.promptbox.move`, one per origin), then the per-key
   write locks for the target and the source, in that order. Re-read the source
   record and the stored target, and run the target's check against this
   window's in-memory target.
3. Append the source's text, mentions, and contexts to the in-memory target
   (after a blank line if it has text), using the existing
   `appendQuoteToDraftText` and `appendAttachmentsToDraft` helpers. Carry only
   attachments whose `projectId` equals the target project, by strict equality,
   not the fix's copy helper. Everything else stays behind, including every
   untagged legacy attachment.
4. Write the target. If that fails, restore the target in memory, change
   nothing else, and show "Couldn't move the draft. Nothing changed."
5. Rewrite the source with only what stayed behind, or write a tombstone when
   nothing is left. If that fails, show "Moved, but the original couldn't be
   updated. Discard it there." Request records are not touched.
6. For a legacy source, add the moved text's hash to the set in
   `bb.promptbox.legacy-moved-3`, and write leftovers with a `rev`.

Without Web Locks, the move runs unlocked, and two windows pressing Move in the
same instant could put the text in both targets. Nothing is lost.

- **Discard** is two-step and inline (no modal). It writes a tombstone for that
  record only, under the same lock and check. Attachment files on the server are
  never deleted.
- **Not now** hides that banner for this window only and writes nothing.
- Leftover attachments show as "N attachments stayed behind", with their file
  names. Discard there removes only those references.

Legacy reappearing: a legacy record with no `rev` after a Move was written by a
pre-upgrade window. Leftovers written by Move carry a `rev`, so they never
trigger this. The legacy banner then says "Unsent draft from a window that
hasn't updated. Reload your other Cloudroom windows." Move stays available. If
the text's hash is in the moved set, the banner says it was already moved.
Residual: an old window can still write the legacy key, and an edited version of
moved text isn't recognized as moved.

## Cloud request evidence

A Cloud send stores `cloudroom-request:<draft key>` = `<fingerprint>:<id>` until
it succeeds. The fingerprint is a SHA-256 of the whole request, including the
project, so a match on any key is the same request.

- Before issuing an ID, the new-thread lookup checks, by fingerprint, the
  draft's own record, the legacy record (`cloudroom-request:` plus the legacy
  key), and every other `cloudroom-request:bb.promptbox.contents-new-thread-*`
  record. On a match it reuses that ID, so the server can de-duplicate an
  ambiguous earlier send.
- A new ID never overwrites an unmatched record. If the draft's own key already
  holds a different fingerprint, the new record goes under
  `cloudroom-request:<draft key>:<id>`, which the lookup also scans.
- A successful send removes only the record whose ID it used. Discard, Move, and
  migration never add, copy, or remove request records.
- Thread sends (`ThreadDetailPromptArea.tsx`) keep today's lookup.
- `cloudroom-queries.ts` changes for this: `cloudroomRequestId` gains the scan
  and the no-overwrite rule for new-thread keys, and the clear takes the record
  that was used.

## Banner UI

- Reviewed design: `apps/app/src/components/promptbox/banner/NewThreadDraftDesign.stories.tsx`
  (design only; built from the existing `ProviderRequirementBanner`,
  `PromptStackCard`, and `Button`). The new states (conflict copy, not in your
  list, couldn't check, unreadable, sent elsewhere, moved elsewhere, legacy
  reappearing, send blocked by an attachment, leftover file names) reuse the
  same banner and actions. They are not in the reviewed renders yet and need
  design review before production UI.
- One slot above the composer shows one state, in priority order: storage
  failure, send blocked by an attachment, move result, sent or moved elsewhere,
  leftover attachments, conflict copy, legacy reappearing, other drafts not
  shown (including couldn't check and unreadable), switch note. Other composer
  banners are unchanged.
- Move failures and couldn't-check rows offer **Retry**. Storage failure offers
  **Copy draft** (clipboard).
- Accessibility: the switch note is a polite live region, and warnings use the
  existing alert role. Focus is not moved to a banner, because it can appear
  while the user is typing. The banner slot comes before the editor in DOM
  order, so its buttons are reachable by Tab and by screen readers.

## Failures

- Storage write failure: the key is marked unsaved and the composer shows
  "Draft not saved on this device". The draft stays in memory for this window.
  `storage` events and re-reads never replace an unsaved in-memory draft. The
  mark clears on the next successful write.
- Storage read failure: never throws during render. The store falls back to
  memory.
- Project no longer available: its attachment folder may already be deleted. Its
  attachments stay behind in the record until discarded.
- Attachment load failure: the reference stays in its draft and the user can
  remove it. Send fails with the server's attachment error and keeps the draft.

## Rollback

- Old builds read only the global key. An untouched legacy draft reappears after
  a downgrade. Per-project drafts, conflict and recovery copies, sent markers,
  tombstones, and the moved-text hashes stay in storage, ignored by old builds,
  and reappear on upgrade.
- Text moved with **Move to** lives in a per-project key, so an old build does
  not show it. Nothing is deleted.
- An old build's schema drops `projectId` and `copyToken` on parse, and its next
  legacy write saves them stripped. Those legacy attachments become untagged:
  they can only be discarded or uploaded again. Nothing is deleted.
- An old build's switch copy sends `{ sourceProjectId, paths }`. The fix's
  server takes only `{ tokens }`, so it fails with a visible 400.
- Migration never adds, copies, or removes request records, so an old build
  still finds the legacy record. Extra `:<id>` records are ignored by old
  builds.

## Tests that change

- `usePromptDraftStorage.test.tsx`: "uses project-agnostic storage for
  new-thread prompt contents" asserted the global key. It is replaced by
  per-project, No project, and legacy-untouched tests.
- `useForkThreadFromMessage.test.tsx` and `plugin-slot-mounts.test.tsx`: the
  new-thread scope now names a project.
- `RootComposeView.test.ts`: the `isCopyingAttachments` field is removed.

New tests: `rev`/`base` and attachment-field round-trip; every check case,
including tombstone and unreadable; adopt sets base; the `base` check on
`storage` events; recovery keys for unlocked writes and their reconciliation;
Move and Discard under the per-key locks, with a typing write in between; Move
flushes the target first; the step 5 failure message; key parsing and the scan
over all three prefixes; conflict copies of an unavailable project; sent
markers and tombstones as empty; unreadable records never overwritten; lookup
timing (only after the list settles, once per new candidate, no retry loop);
the not-in-your-list row having no Move; untagged attachments never carried;
send blocked for absolute, scheme, untagged, and foreign references; request
lookup reusing a legacy or other-key match when the own key holds an unrelated
record, and never overwriting it; legacy reappearing.

The tests in the held implementation were written after its code. They are
retrospective and count only after each is shown to fail on the pre-change
code. Each new fix starts with a failing test, then the smallest change that
passes it, then refactoring.

## Integration with the attachment fix

The attachment fix (owner: `fix cross-project image replay`, branch
`room/fix-cross-project-image-replay-yuuh`) owns attachment path authorization,
ownership, owner tags, copy tokens, copy, replay, and containment, on the server
and in Cloud commands. Its strict file-scope candidate is still in progress, so
no head is an integration baseline. The table reflects its client changes at
`0e249aad` and is rechecked against its final reviewed head.

| Shared file | Attachment fix owns (kept) | This ticket owns |
| --- | --- | --- |
| `client-core/.../prompt-draft.ts` | `projectId` and `copyToken` on attachments and their schema, `getCrossProjectPromptAttachmentCopies` | uses `appendQuoteToDraftText` and `appendAttachmentsToDraft` as they are |
| `AttachmentPreview.tsx` | owner-aware preview source | not touched |
| `NewThreadComposer.tsx` | upload tagging, submit-time copy protection | draft scope, keyed snapshot, per-key uploads, send block, banners, project-scoped switch coordination |
| `cloudroom-queries.ts` | not touched | new-thread request lookup and clear |
| `RootComposeView.test.ts` | its new tests | removing the `isCopyingAttachments` field |

- Order: the attachment fix lands first and stays intact, including its
  standalone global-draft path. This ticket rebases onto its final reviewed head
  and adapts only the switch path listed under Switching (the call site at
  `NewThreadComposer.tsx:1330` at `0e249aad`). The submit-time copy call stays.
  Nothing of the fix is removed wholesale. Until then, draft storage and
  migration stay isolated in `usePromptDraftStorage.ts` and the banner
  component.
- Requests to the fix owner, not decided here:
  - untagged previews get no preview source, instead of the composer's project
    (`AttachmentPreview.tsx:135`);
  - the submit call passes an explicit owner instead of the helper's untagged
    default;
  - tokens never expire and can copy into any public project.
- The attachment product policy is approved (see Ownership). Its enforcement
  is the fix's and is not verified. Blocking dependencies, each checked on the
  fix's exact final candidate before integration:
  - the server keeps rejecting send paths outside the request project's folder;
    owner-tag checks on the server would need the tag on the wire, a protocol
    bump that is the fix's call;
  - cross-project copy accepts only server-issued upload tokens, never paths,
    and checks source and destination;
  - absolute and scheme paths never reach a file read on the Cloud dispatch
    path or the local send path (the local provider's read is not traced);
  - who may call the copy route.
- The recent-project picker (`room/project-picker-recents`) stays separate. This
  ticket does not touch picker files or project-list queries.

## Decisions

- Concurrent windows keep conflicting work recoverable (Jake). See Concurrent
  windows. Unlocked writes use recovery keys, so this holds without Web Locks.
- Typing is allowed while projects load, and the draft keeps its original
  project (Jake). See Drafts not shown in the composer.
- Attachment product policy approved (2026-10-20 08:20 UTC). It decides that
  untagged legacy attachments can't be assigned by assertion. Enforcement is
  not verified.
- The project-scoped switch coordination is adapted only after the contract
  gate.
- Not yet recorded:
  - coordinator sign-off on removing the switch copy path listed under
    Switching (the product behavior is already approved);
  - product sign-off that, without Web Locks, two windows pressing Move at the
    same instant may put the text in two projects (nothing is lost);
  - acceptance that marking which projects hold drafts stays with the picker
    ticket.
