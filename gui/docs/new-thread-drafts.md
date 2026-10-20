# New-thread drafts

The new-thread composer keeps one unsent draft per project. Switching projects
leaves the draft with its project and shows the destination project's draft.
Nothing moves, disappears, or sends because of a switch. Cross-device sync is
out of scope.

## Storage

- Drafts live in browser `localStorage`, in the existing prompt-draft store
  (`apps/app/src/hooks/usePromptDraftStorage.ts`) and its existing record format
  (`PromptDraftState`), plus an optional `rev` (see Concurrent windows).
- Key: `bb.promptbox.contents-new-thread-<projectId>-3`, built with the store's
  existing `normalizeStorageSegment` (trim, then `encodeURIComponent`).
- `projectId` is the composer's project: a real project ID, or `proj_personal`
  for **No project**. No project is its own draft.
- Identity is the browser origin plus the project ID. Each Cloudroom server has
  its own origin (`127.0.0.1:<port>`, or `<mac-handle>.cloudroom.run` on the
  phone), and project IDs are random server IDs, never display names. Projects
  belong to the server, not to an account, so switching accounts does not
  change which draft a project shows.
- Unchanged: thread drafts (`bb.promptbox.contents-<projectId>-<threadId>-3`),
  plugin composer drafts, automation-edit drafts, and the recent-project picker.

## Callers

Every new-thread scope names its project:

- The root composer and plugin composers that use the `new-thread` kind pass the
  composer's project.
- Fork from message writes its quote to `source.projectId`, the project it then
  opens.
- The plugin SDK's route fallback (`plugin-sdk-hooks.ts`, no composer host) uses
  the route project, else the project the root composer currently shows, so it
  writes the draft the composer shows.
- Report-bug and `?prompt=` no longer replace an unsent draft. If the visible
  draft has content, the prompt is appended after a blank line. An empty draft
  behaves as before.

## Ownership

- The draft key decides which project's draft a record is. It never authorizes
  an attachment.
- Attachment ownership comes only from the attachment fix's verified owner tag
  (`attachment.projectId`, set at upload), enforced by the server on send and
  copy. A draft key, a unique stored filename, or a successful GET is never
  evidence of ownership.
- Untagged, foreign-tagged, absolute, or otherwise unverifiable references are
  never carried into another record. They stay where they are, recoverable,
  until the attachment ticket's pending authorization policy says otherwise.
- Switching projects does not copy attachment files.
- Uploads bind to the draft they started in. In-flight state, the "one upload at
  a time" guard, and upload errors are tracked per draft key. An upload that
  finishes after a switch is added to its original draft with the fix's owner
  tag, the rest of the batch continues there, and its error shows when the user
  returns. Nothing is dropped, and the file is never added to the visible draft
  by mistake.
- Send clears only the captured sending draft, and only if it still matches.
  Switching stays blocked while a send is in flight. Queue and send are
  otherwise unchanged.
- The keyed snapshot, per-key uploads, and captured-draft clear ship together
  with the no-copy switch. The switch change never lands alone.

## Switching

- Edits reach the in-memory cache synchronously, so changing the key is the
  atomic step. The origin draft's pending debounced write is flushed to storage
  at the switch.
- The "restore draft after option change" snapshot stores
  `{ storageKey, draft }` and restores only when the key still matches. A project
  switch never takes a snapshot.
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

- Each stored new-thread record carries a random `rev` (old builds ignore it).
  Each window remembers, per key, the `rev` its content is based on: the one it
  last read or wrote.
- Before writing, a window re-reads the stored record:
  - Same `rev` as its base: write normally with a new `rev`.
  - Different `rev`, same content as this window's: adopt it, no copy.
  - Different `rev`, stored record empty: write normally.
  - Different `rev`, stored record is a **sent marker** (below): write normally
    and show "This draft was sent from another window. What you see is your
    unsent copy." Nothing sends by itself.
  - Different `rev`, different non-empty content: first save the stored record
    as a **conflict copy** under
    `bb.promptbox.contents-new-thread-conflict-<projectId>-<rev>-3` (skipped if
    it already exists), then write this window's content.
- If the conflict copy can't be saved, the stored record is not overwritten.
  This window keeps its content in memory and shows "Draft not saved on this
  device".
- A `storage` event replaces a window's draft only when that window has no
  pending or unsaved write. That is safe because the other window's write ran
  the check above against this window's last `rev`.
- A successful send clears its draft by writing a sent marker
  (`{ "rev": "...", "sent": true }`, read as empty) instead of removing the key.
- Residual: `localStorage` has no cross-window compare-and-swap, so two windows
  writing the same key within the same instant can still race. The debounced
  writes make this rare. It is named, not hidden.
- Thread drafts keep today's behavior. This rule covers new-thread drafts only.

## Drafts not shown in the composer

A saved draft the composer can't show as the visible project's draft appears in
a banner. It is never assigned, merged, moved, or deleted without a click.
Upgrade writes, copies, and removes nothing.

| Kind | How it's found | Shown in | Actions |
| --- | --- | --- | --- |
| Legacy | Old global key `bb.promptbox.contents-draft-3`. Owner unknown. | Every project | Move to, Discard, Not now |
| Conflict copy | A conflict key for this project | That project only | Add to this draft, Discard, Not now |
| Project no longer available | Lookup returned 404 `project_not_found` or `project_unavailable` | Every project | Move to, Discard, Not now |
| Project not in your list | Lookup returned 200 (for example, a hidden project) | Every project | Move to, Not now |
| Couldn't check | Lookup failed or returned anything else | Every project | Retry, Not now |

Lookup:

- A per-project key is a candidate when its project is not `proj_personal` and
  not in the settled sidebar list (successful, non-placeholder). Detection scans
  this store's keys (cache plus `localStorage`).
- Each candidate is checked with `GET /api/v1/projects/:id`, fresh every time.
  Only the two 404 codes above count as no longer available, and the copy says
  "no longer available", never "deleted". Errors, timeouts, and other statuses
  are "couldn't check".
- The lookup runs again right before **Move to** or **Discard** on a
  no-longer-available draft. If the answer changed, the action stops.

Typing while projects load:

- The user can type while the project list loads. The text is written under the
  requested project's key. If that project then proves unavailable or not in the
  list, the composer shows No project, and the typed draft stays under its
  original key with its original project ID. It is never reassigned, its
  attachments never move, and nothing sends. It appears in the banner above.

**Move to <project>** and **Add to this draft**:

1. Single-flight. The target project is captured at click.
2. Inside an exclusive Web Lock (`navigator.locks`, one lock name for all moves
   on this origin), re-read the source record and the target draft.
3. Append the source's text, mentions, and contexts to the target (after a
   blank line if it has text). Carry only attachments whose verified owner tag
   equals the target project. Everything else stays behind.
4. Write the target. If that fails, restore the target in memory, change
   nothing else, and show "Couldn't move the draft. Nothing changed."
5. Rewrite the source with only what stayed behind. Remove the key only when
   nothing is left.
6. Carry the source's Cloud request evidence (below).

Without Web Locks (Safari before 15.4), the move runs unlocked, and two windows
pressing Move in the same instant could put the text in both targets. Nothing is
lost.

- **Discard** is two-step and inline (no modal). It removes that record only.
  Attachment files on the server are never deleted.
- **Not now** hides that banner for this window only and writes nothing.
- Leftover attachments show as "N attachments stayed behind". Discard there
  removes only those references.

## Cloud request evidence

A Cloud send stores `cloudroom-request:<draft key>` = `<fingerprint>:<id>` until
it succeeds. The fingerprint covers the whole request, including the project.

- When a draft has no request record of its own, the request-ID lookup also
  checks the legacy key's record. If the fingerprint matches, it reuses that ID
  instead of issuing a new one, so the server can de-duplicate an ambiguous
  pre-upgrade send.
- **Move to** copies the source's request record to the target key when the
  target has none. If the target has its own, both stay where they are.
- A request record is removed only by a successful send that used it. Discard
  and migration never remove request records.

## Banner UI

- Reviewed design: `apps/app/src/components/promptbox/banner/NewThreadDraftDesign.stories.tsx`
  (design only; built from the existing `ProviderRequirementBanner`,
  `PromptStackCard`, and `Button`). The new states (conflict copy, not in your
  list, couldn't check, sent elsewhere) reuse the same banner and actions.
- One slot above the composer shows one state, in priority order: storage
  failure, move result, sent elsewhere, leftover attachments, conflict copy,
  other drafts not shown, switch note. Other composer banners are unchanged.
- Move failures offer **Retry**. Storage failure offers **Copy draft**
  (clipboard).
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
  a downgrade. Per-project drafts, conflict copies, and sent markers stay in
  storage, ignored by old builds, and reappear on upgrade.
- Text moved with **Move to** lives in a per-project key, so an old build does
  not show it. Nothing is deleted.
- An old build's schema drops the owner tag. Its send uses the draft's project,
  and the server rejects a path from another project with a visible error.
- Migration only adds or copies request records and never removes them, so an
  old build still finds the legacy record.

## Tests that change

- `usePromptDraftStorage.test.tsx`: "uses project-agnostic storage for
  new-thread prompt contents" asserted the global key. It is replaced by
  per-project, No project, and legacy-untouched tests.
- `useForkThreadFromMessage.test.tsx` and `plugin-slot-mounts.test.tsx`: the
  new-thread scope now names a project.
- `RootComposeView.test.ts`: the `isCopyingAttachments` field is removed.

## Integration with the attachment fix

The attachment fix (owner: `fix cross-project image replay`, branch
`room/fix-cross-project-image-replay-yuuh`) owns attachment path authorization,
ownership, owner tags, copy, replay, and containment, on the server and in
Cloud commands. Its strict file-scope candidate is still in progress, so no head
is an integration baseline yet. The table reflects its client changes as
observed and is rechecked against its final reviewed head.

| Shared file | Attachment fix owns (kept) | This ticket owns |
| --- | --- | --- |
| `client-core/.../prompt-draft.ts` | owner tag and schema, `getProjectOwnedPromptAttachmentPaths`, `getCrossProjectPromptAttachmentCopies` | new `appendPromptDraft` (keeps attachment objects, including tags) |
| `AttachmentPreview.tsx` | owner-aware preview source | not touched |
| `NewThreadComposer.tsx` | upload tagging, submit-time copy protection | draft scope, keyed snapshot, per-key uploads, banners, project-scoped switch coordination |
| `RootComposeView.test.ts` | its new tests | removing the `isCopyingAttachments` field |

- Order: the attachment fix lands first and stays intact, including its
  standalone global-draft path. This ticket rebases onto its final reviewed head
  and adapts only the project-scoped switch coordination: the switch no longer
  copies, because drafts no longer cross projects. Nothing of the fix is removed
  wholesale. Until then, draft storage and migration stay isolated in
  `usePromptDraftStorage.ts`, the banner component, and `appendPromptDraft`.
- The attachment authorization, project-upload, and copy policy is pending with
  the attachment ticket. This contract assumes nothing about it beyond owner
  tags and server enforcement.
- The recent-project picker (`room/project-picker-recents`) stays separate. This
  ticket does not touch picker files or project-list queries.

## Decisions

- Concurrent windows keep conflicting work recoverable (Jake). See Concurrent
  windows.
- Typing is allowed while projects load, and the draft keeps its original
  project (Jake). See Drafts not shown in the composer.
- The project-scoped switch coordination is adapted only after the contract
  gate. The attachment authorization policy stays pending with that ticket.
