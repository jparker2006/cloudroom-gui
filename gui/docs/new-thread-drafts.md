# New-thread drafts

The new-thread composer keeps one unsent draft per project. Switching projects
leaves the draft with its project and shows the destination project's draft.
Nothing moves, disappears, or sends because of a switch. Cross-device sync is
out of scope.

## Storage

- Drafts live in browser `localStorage`, in the existing prompt-draft store
  (`apps/app/src/hooks/usePromptDraftStorage.ts`) and its existing record format
  (`PromptDraftState`).
- Key: `bb.promptbox.contents-new-thread-<projectId>-3`, built with the store's
  existing `normalizeStorageSegment` (trim, then `encodeURIComponent`).
- `projectId` is the resolved composer project: a real project ID, or
  `proj_personal` for **No project**. No project is its own draft.
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
  resolved composer project.
- Fork from message writes its quote to `source.projectId`, the project it then
  opens.
- The plugin SDK's route fallback (`plugin-sdk-hooks.ts`, no composer host) uses
  the route project, else the root composer's selected project resolved by the
  composer's rule (a project the settled list doesn't contain becomes
  `proj_personal`), so it writes the draft the composer shows.
- Report-bug and `?prompt=` no longer replace an unsent draft. If the visible
  draft has content, the prompt is appended after a blank line. An empty draft
  behaves as before.

## Ownership

- A draft's project-stored attachments belong to the project in its key. The
  composer previews and sends them with that project ID.
- Switching projects does not copy attachment files. The copy call on project
  switch is removed (see Integration).
- Uploads bind to the draft they started in. In-flight state, the "one upload at
  a time" guard, and upload errors are tracked per draft key. An upload that
  finishes after a switch is added to its original draft, the rest of the batch
  continues there, and its error shows when the user returns. Nothing is
  dropped, and the file is never added to the visible draft by mistake.
- Send clears only the draft that was sent, and only if it still matches.
  Switching stays blocked while a send is in flight. The Cloud request-ID record
  stays keyed by the sending draft's key. Queue and send are otherwise unchanged.

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

## Unassigned drafts

An **unassigned draft** is a saved draft the composer cannot show as any
project's draft:

1. **Legacy**: the old global key `bb.promptbox.contents-draft-3`. Its owner is
   unknown: the old composer carried it across switches, and each tab could have
   had a different project selected.
2. **Orphaned**: a per-project key whose project the server says is gone.
   Detection scans this store's keys (cache plus `localStorage`). A key is a
   candidate when its project is not `proj_personal` and not in the sidebar list
   (successful, non-placeholder). Each candidate is then checked with
   `GET /api/v1/projects/:id`, once per candidate per window, fresh each time
   (no cached result). Only a 404 with `project_not_found` or
   `project_unavailable` means orphaned. A hidden project returns 200 and is
   not orphaned; its draft returns when the project is unhidden. Any other
   result, including errors, shows nothing for that key and allows no action.
   The same check runs again right before **Move to** or **Discard** acts on an
   orphaned draft. If it no longer returns 404, the action stops and the banner
   disappears.

Rules:

- Upgrade writes, copies, and removes nothing. Never auto-assign, auto-merge, or
  auto-delete an unassigned draft.
- The composer shows one banner (legacy first, with "1 of N" when there are
  more) in every project. It refreshes on local writes and `storage` events.
- **Move to <project>** assigns it to the visible project:
  1. Single-flight: the button is disabled while a move runs.
  2. Capture the target project at click. Results go to that project even if
     the user switches during the check.
  3. Skip, as staying behind, any attachment with an absolute path or with an
     owner tag (from the attachment fix) that differs from the target. Check
     each remaining project-stored attachment in the target with a GET to the
     existing attachment content route, cancelling the body once headers
     arrive. 2xx means present (stored names are unique per upload). Only 404
     means missing. Anything else means unknown, and the banner offers a retry.
     Cost: the server reads each checked file once per click (up to the 25 MB
     upload limit). This runs only on an explicit click, never on load.
  4. Inside an exclusive Web Lock (`navigator.locks`, one lock name for all
     moves on this origin), re-read the unassigned record and the target draft
     synchronously. Append the record's text, mentions, contexts, and present
     attachments to the target (after a blank line if it has text).
  5. Write the target immediately. If that write fails, restore the target in
     memory, change nothing else, and show "Couldn't move the draft. Nothing
     changed."
  6. Rewrite the record with only what stayed behind (missing, unknown, or
     absolute-path attachments). Remove the key only when nothing is left.
  Steps 4–6 run synchronously inside the lock, so a second tab's move re-reads
  the record after the first one finishes and finds it gone, so text is not
  duplicated. Exception: in a browser without Web Locks (older than
  Chromium/Electron with locks or Safari 15.4), the move runs unlocked, and two
  tabs pressing Move in the same instant could put the text in both targets.
  Nothing is lost.
- **Discard** is two-step and inline (no modal). It removes that key only.
  Attachment files on the server are never deleted.
- **Not now** hides that banner for this window only and writes nothing.
- Unverified attachments never join another project. An absolute path is never
  a valid project attachment for a move and always stays behind (shared strict
  file-scope rule).
- Attachment ownership: the draft key decides which project a draft belongs to.
  Where the attachment fix's owner tag is present, the tag decides that
  attachment's owner for preview, send-time copy, and moves.

## Banner UI

- Reviewed design: `apps/app/src/components/promptbox/banner/NewThreadDraftDesign.stories.tsx`
  (design only; built from the existing `ProviderRequirementBanner`,
  `PromptStackCard`, and `Button`).
- One slot above the composer shows one state, in priority order: storage
  failure, move result, leftover attachments, legacy or orphaned draft, switch
  note. Other composer banners (Cloud, machine access) are unchanged.
- Actions: **Move to <project>**, **Discard**, **Not now**. Leftover attachments
  offer **Move rest to <project>**, and the copy says the text already moved and
  Discard removes only the leftovers. Move failures offer **Retry**. Storage
  failure offers **Copy draft** (clipboard).
- Accessibility: the switch note is a polite live region, and warnings use the
  existing alert role. Focus is not moved to a banner, because it can appear
  while the user is typing.

## Failures

- Storage write failure: the key is marked unsaved and the composer shows
  "Draft not saved on this device". The draft stays in memory for this window.
  `storage` events and re-reads never replace an unsaved in-memory draft. The
  mark clears on the next successful write.
- Storage read failure: never throws during render. The store falls back to
  memory.
- Other tabs: a `storage` event refreshes a key unless this tab has a pending or
  unsaved write for it. Last write wins for the whole record, as for thread
  drafts today. An attachment added in one tab can be overwritten by another
  tab's later edit of the same project's draft. The file stays on the server.
- Deleted project: the composer falls back to No project, and the deleted
  project's draft becomes orphaned. Deleting a project deletes its attachment
  folder, so its attachments fail the check and stay behind until discarded.
- Project-list load window: while the list loads, the composer uses the
  requested project's key. If that project turns out to be gone, anything typed
  there becomes an orphaned draft. It is recoverable, not lost.
- Attachment load failure: the reference stays in its draft and the user can
  remove it. Send fails with the server's attachment error and keeps the draft.

## Rollback

- Old builds read only the global key. An untouched legacy draft reappears after
  a downgrade. Per-project drafts stay in storage, ignored by old builds, and
  reappear on upgrade.
- Text moved with **Move to** lives in a per-project key, so an old build does
  not show it. Nothing is deleted.
- An old build's schema drops the attachment fix's owner tag. Its send then
  uses the draft's project, and the server rejects a path from another project
  with a visible error. Nothing is sent to the wrong project.
- Cloud request IDs: a send that was ambiguous before the upgrade was keyed by
  the global key. A retry after the upgrade gets a new request ID, so a
  duplicate Cloud thread is possible in that one case. It was already possible
  before for any changed draft, because the ID is fingerprinted on the request.

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
ownership, copy, replay, and containment, on the server and in Cloud commands.
Its strict file-scope candidate is still in progress, so no head is an
integration baseline yet. This table reflects its client changes as observed,
and is rechecked against its final reviewed head before integration. Neither
ticket removes the other's reviewed changes.

| Shared file | Attachment fix owns | This ticket owns |
| --- | --- | --- |
| `client-core/.../prompt-draft.ts` | `PromptDraftAttachment.projectId` owner tag and schema, `getProjectOwnedPromptAttachmentPaths`, `getCrossProjectPromptAttachmentCopies` | new `appendPromptDraft` (keeps attachment objects, including the tag, unchanged) |
| `AttachmentPreview.tsx` | owner-aware preview source | not touched |
| `NewThreadComposer.tsx` | submit-time cross-project copy; owner tag on uploads | draft scope, snapshot key, per-key uploads, switch note, banners, `handleProjectChange` |
| `RootComposeView.test.ts` | its new tests | removing the `isCopyingAttachments` field |

- Order: the attachment fix lands first. This ticket rebases onto its final
  reviewed head, then reruns affected checks. Until then, draft storage and
  migration stay isolated in `usePromptDraftStorage.ts`, the banner component,
  and `appendPromptDraft`.
- The recent-project picker (`room/project-picker-recents`) stays separate. This
  ticket does not touch picker files or project-list queries.
- Uploads: this ticket binds uploads to their draft and keeps the fix's owner tag
  (`{ ...uploaded, projectId: ownerProjectId }`).
- Project switch: the fix narrows the switch copy to owned paths. This ticket
  removes the switch copy entirely, as approved. The fix's helper stays exported
  and tested. Only the call site goes. **Needs coordinator sign-off.**
- Move to: an attachment tagged with a different project stays behind. This
  ticket does not rely on the fix's submit-time copy for unassigned drafts.
- The `attachments.copy` route stays. Its submit-time use belongs to the fix.
- Absolute-path attachments reaching the dispatch path are the fix's scope.

## Open choices

1. Sign off the `handleProjectChange` split above. The UX and attachment
   reviewers support removing the switch copy, and no reviewer opposes it.
2. Accept last-write-wins for the same project's draft across tabs (recommended,
   matches thread drafts), or merge attachments by path.
3. Accept the project-list load window above (recommended), or block editing
   until projects load.
