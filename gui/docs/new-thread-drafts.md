# New-thread drafts

The new-thread composer keeps one unsent draft per project. Switching projects
leaves the draft with its project and shows the destination project's draft.
Nothing moves, disappears, or sends because of a switch.

## Storage

- Drafts live in browser `localStorage`, in the existing prompt-draft store
  (`apps/app/src/hooks/usePromptDraftStorage.ts`) and its existing record format
  (`PromptDraftState`: text, mentions, attachments, contexts).
- Key: `bb.promptbox.contents-new-thread-<encodeURIComponent(projectId)>-3`.
- `projectId` is the resolved composer project: a real project ID, or
  `proj_personal` for **No project**. No project is its own draft.
- Identity is the browser origin plus the project ID. Each Cloudroom server has
  its own origin (`127.0.0.1:<port>`, or `<mac-handle>.cloudroom.run` on the
  phone), and project IDs are random server IDs, never display names. Projects
  belong to the server, not to a Claude or Cloudroom account, so switching
  accounts does not change which draft a project shows.
- Thread drafts (`bb.promptbox.contents-<projectId>-<threadId>-3`), plugin
  composer drafts, and automation-edit drafts are unchanged.

## Ownership

- A draft's project-stored attachments (relative paths under
  `attachments/<projectId>/`) belong to the project in its key. The composer
  loads, previews, and sends them only with that project ID.
- Switching projects does not copy attachment files. The old
  `attachments.copy` call on project switch is removed.
- An upload that finishes after the user switched away is added to the draft
  of the project it was uploaded to, not the visible one. Its error, if any,
  shows when the user returns to that project.
- Send clears only the draft that was sent, and only if it still matches what
  was sent. Queue and send behavior is otherwise unchanged.

## Switching

- Edits are written to the in-memory cache synchronously, so the switch itself
  is the atomic step: the key changes and the destination draft is read.
- The origin draft's pending debounced write is flushed to storage at the switch.
- The "restore draft after option change" snapshot is bound to its storage key.
  It never restores across a project switch.

## Legacy and unassigned drafts

An **unassigned draft** is a saved draft the composer cannot show as any
project's draft:

1. **Legacy draft**: the old global key `bb.promptbox.contents-draft-3`. Its
   owner is unknown: the old composer carried it across switches and copied
   attachments, and each tab could have had a different project open.
2. **Orphaned draft**: a per-project key whose project is not in the settled
   project list (for example, the project was deleted). Detection waits for a
   successful, non-placeholder project list.

Rules:

- Never auto-assign, auto-merge, or auto-delete an unassigned draft. Upgrade
  does not write, copy, or remove anything.
- The composer shows a banner for one unassigned draft (legacy first), in every
  project, until the user acts. Actions:
  - **Move here** (explicit assignment to the visible project):
    1. Re-read the unassigned record from storage.
    2. Verify each project-stored attachment exists in the visible project
       (`attachments.read`). Stored names are unique per upload, so existing
       there means it was uploaded or copied there.
    3. Merge text, mentions, contexts, and verified attachments into the visible
       draft (append after a blank line if that draft is not empty).
    4. Write the visible draft and confirm it persisted. On failure, nothing
       changes and the banner shows an error.
    5. Rewrite the unassigned record with only what did not move (unverified or
       absolute-path attachments). Remove the key only when nothing is left.
  - **Discard** (two-step, inline): removes that unassigned key only. Attachment
    files on the server are never deleted.
- Unverified attachments are never attached to another project. Under the
  shared strict file-scope rule, absolute or unverifiable paths stay in the
  unassigned record until discarded.

## Failures

- Storage read or write failure: the draft stays in memory for this window and
  the composer shows "Not saved on this device". Switching back and forth in the
  same window keeps it.
- Other tabs: a `storage` event refreshes a key unless this tab has a pending
  write for it. Last write wins, as for thread drafts. Each tab keeps its own
  selected project.
- Deleted project: the composer falls back to No project and the deleted
  project's draft becomes an orphaned draft (above).
- Attachment load failure: the reference stays in its draft. The tile shows a
  broken preview and the user can remove it. Send fails with the server's
  attachment error and keeps the draft.

## Rollback

Old builds read only the global key. Because migration never writes or removes
it, an untouched legacy draft reappears after a downgrade. Per-project drafts
stay in storage, ignored by old builds, and reappear on upgrade.

## Integration dependencies

- The attachment-fix ticket (`fix cross-project image replay`) owns attachment
  path authorization (`apps/server/src/services/projects/attachments.ts`,
  teleport, queue filtering). This change touches none of those files. It
  relies on `attachments.read` failing for any path not inside the project's
  attachment folder; that fix tightens the same reader, which only makes
  verification stricter.
- The recent-project picker is not touched.
