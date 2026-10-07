# Person-mention notifications from Text cells and row titles

Status: proposed for AppFlowy-Web PR #593 and AppFlowy-Premium PR #1433. Revision 2.1 (after review; see the review log and the "User decisions" table at the end of `RICH_TEXT_FORMAT.md`). This document uses the path legend of `RICH_TEXT_FORMAT.md`, plus `srv:` = `/Users/weidongfu/Documents/AppFlowy-Cloud-Preminum` (checked out on `feat/rust-server-backup-restore`; line numbers are from that checkout).

The user's binding decisions:

- Notify on **save**, not on pick, and only people newly added by the save (found by diffing the saved deltas).
- Send one consistent target from both clients: database view id + row id, `is_row_document: false`, and the row title as the page name.
- Deduplicate.
- A web inbox click opens the row.
- Desktop sends no empty strings for missing ids.
- The web honors the @-menu "Send notification" toggle exactly as Desktop does (same stored preference, same default, shared with documents), and skips self-mentions as Desktop does. *Confirmed by the user on 2026-10-02:* the default is **off** on web as on Desktop, including for web documents (section 2.3).

## 1. Today

| | Web | Desktop |
|---|---|---|
| When | When a person is picked in the shared `MentionPanel`: `handleSelectedSearchResult` → `notifyPersonMention` (`web:src/components/editor/components/panels/mention-panel/MentionPanel.tsx:954-972, 916-952`). This happens before the cell is saved. | When a person is picked: `_onSearchPersonSelected` → `MentionEvent.mentionPerson` (`dt:lib/features/mention_person/presentation/widgets/person/person_list.dart:133-226`, sent at :213-223), also before the save. A widget test asserts it (`dt:test/widget_test/database/rich_text_cell/rich_text_cell_menus_test.dart:94-99`). |
| Toggle | None. Always sends `require_notification: true` (`MentionPanel.tsx:942`). | "Send notification" in the People section header (`dt:lib/features/mention_person/presentation/mention_menu.dart:228-230`). |
| Self-mention | Not skipped on the client. The server does not skip it either. | Skipped in Rust before any network call (`rs:flowy-share/src/mention_manager.rs:676-678`). |
| Target view | `mention.page_id \|\| mentionContext.view_id` = the database view (`RichTextCellContext.tsx:25-35`) | `host.viewId` = the database view (`person_list.dart:147`; `rich_text_cell_editor.dart:495-498`) |
| `is_row_document` | `Boolean(rowId)` = **true** (`MentionPanel.tsx:945`). The server then logs a warning and falls back (`srv:libs/appflowy-cloud-pages/src/biz/workspace/page_view.rs:11862-11886`). | Computed in Rust as `view.parent_view_id == view_id` = false (`mention_manager.rs:697`) |
| `view_name` | The database view's name, from `loadViewMeta` (`MentionPanel.tsx:927-934`) | The view's name. `rowDocumentTitle` is set only when there is a `RowDetailBloc` (`person_list.dart:174-181`), so cells and titles send the database view's name. |
| `block_id` / `row_id` | `null` / `rowId` | `blockId ?? ''` and `rowId ?? ''` (`dt:lib/workspace/application/view/view_service.dart:486, 488`). The empty string reaches the server as `Some("")`, and the email link gets an empty `blockId=` (`srv:libs/appflowy-cloud-core/src/biz/notification/delivery.rs:266-274`). |
| Dedup | None. Every call creates a new inbox item (`srv:libs/appflowy-cloud-core/src/biz/notification/service.rs:104`). | None |
| Inbox click | `toView(viewId, block_id)`. `row_id` is ignored (`web:src/components/notifications/NotificationItem.tsx:200-208`). | Opens the row when `row_id` is present (`dt:lib/workspace/presentation/notifications/widgets/notification_navigation_action.dart:22-58`; `row_document_navigation_context.dart:38-60`). |

## 2. The "Send notification" toggle

### 2.1 Desktop semantics (normative for both clients)

- **Storage.** `KVKeys.atMenuSendNotification = 'atMenuSendNotification'` (`dt:lib/core/config/kv_keys.dart:145-148`), a bool in `SharedPreferences`. It is per device and per installation. It is not tied to a user or a workspace, and it does not sync.
- **Default: `false`.** `DartKeyValue.getBool(key, {defaultValue = false})` returns `false` when the key is missing (`dt:lib/core/config/kv.dart:85-94`). On a fresh install, nobody is notified until the user turns the toggle on.
- **Read.** The menu reads the value each time it opens (`mention_menu_service.dart:146-148`; mobile: `mobile_mention_menu_service.dart:84-85`; invite submenu: `widgets/invite/invite_menu.dart:257-258`) and seeds `MentionBloc.state.sendNotification` with it.
- **Write.** Every flip is saved right away (`mention_menu.dart:99-108`). Flips are ignored when `collaborationActionsEnabled` is false (`mention_bloc.dart:180-189`).
- **Shared.** Documents, row documents and cells use the same key.
- **Use.** At pick time, `_onMentionPerson` calls the repository with `requireNotification: state.sendNotification` (`mention_bloc.dart:216-244`). The call is made even when the toggle is off: the mention is still recorded. With `require_notification=false` the server records `af_page_mention`, updates the recent-mention cache and broadcasts the list change, but resolves no recipient (`srv:.../page_view.rs:11892-11902`). So no inbox item, push or email is created.
- **Failure.** A toast (`document.mentionMenu.notifedToFailed`) is shown only when the toggle was on (`mention_bloc.dart:236-241`).

### 2.2 Web equivalent

- **N1.** A new module `web:src/components/editor/components/panels/mention-panel/mention-notification-preference.ts` exports `getSendMentionNotification(): boolean`, `setSendMentionNotification(value: boolean)` and `useSendMentionNotification(): [boolean, (v: boolean) => void]`.
  - Storage is `localStorage['atMenuSendNotification']` holding `'true'` or `'false'`. The key name matches Desktop's.
  - The default is **false** when the key is missing or unreadable. Every access is wrapped in try/catch.
  - The value is read when the panel opens, and written on every flip. A `storage` event listener keeps other open tabs in step.
- **N2.** The panel shows a "Send notification" switch in the People section title. It appears only when person results are rendered: in app mode with `searchMentions`, which is the only source of people results (`MentionPanel.tsx:391-397`). `MentionSectionTitle` (`:365-371`) takes an optional trailing element. The switch MUST NOT take keyboard focus away from the editor, and toggling it MUST NOT close the panel.
- **N3 (documents).** Documents keep notifying on pick, but `notifyPersonMention` sends `require_notification: getSendMentionNotification()` instead of `true` (`MentionPanel.tsx:942`). It still calls the API when the toggle is off, so the mention is recorded as on Desktop. On failure it shows a toast only when it asked for a notification, using `document.mentionMenu.notifedToFailed` ("Unable to send the notification due to network error"; the same key and text as Desktop).
- **N4 (self, fail closed).** `notifyPersonMention` returns without a network call when the mentioned id equals the current user's id, compared as UUIDs (case-insensitively, after trimming), as Rust compares parsed UUIDs (`mention_manager.rs:675-678`). The current user comes from `useCurrentUserOptional` (already read at `MentionPanel.tsx:393`). **If the current user is unknown, it sends nothing**: the server does not skip self-mentions, so failing open would notify the user about themselves.
- **Behavior change.** Web documents switch from "always notify" to "notify only if the toggle is on", with the toggle off by default, exactly as on Desktop. *Confirmed by the user on 2026-10-02:* the default is off, the preference is shared with documents, and the PR MUST carry the release note in 2.3.

### 2.3 Release note (web toggle default)

Paste this into the AppFlowy-Web PR #593 description and the web release notes:

> **@-mentions now follow the "Send notification" switch.** When you @-mention someone in a document, a database Text cell or a row title, AppFlowy on the web now notifies them only if "Send notification" is turned on in the People section of the @ menu, the same as the desktop app. The switch is **off by default**, so after this update web @-mentions in documents no longer notify people until you turn it on; previously the web always sent a notification. The mention itself is still recorded either way, and you are never notified when you mention yourself. Your choice is remembered in this browser and applies to documents and databases alike.

## 3. When cells and titles notify

### 3.1 Rule

- **N5.** A Text cell or row title editor MUST NOT notify at pick time. On web, `MentionPanel` sees a new optional editor-context callback, `onPersonMentionPicked(personId: string, requireNotification: boolean)` (`web:src/components/editor/EditorContext.tsx:124-125`, next to `mentionContext`). `RichTextCellContext` provides it (`web:.../rich-text/RichTextCellContext.tsx:46-62`). When the callback is present, `handleSelectedSearchResult` calls it **instead of** `notifyPersonMention`. On Desktop, `MentionMenuHost` gains `final void Function(String personId, bool requireNotification)? onPersonPicked;` (`dt:lib/features/mention_person/presentation/mention_menu_host.dart:11-50`). When `host?.onPersonPicked` is set, `_onSearchPersonSelected` calls it instead of `MentionEvent.mentionPerson` (`person_list.dart:212-224`). Documents, which have no host and no callback, keep today's path.
- **N6 (the cell ledger).** Each client keeps a **module-level** registry of ledgers keyed by `(workspaceId, rowId, fieldId)`, like the web's `pendingCellSaves` (`RichTextCellEditor.tsx:115-118`). A ledger is not owned by an editor: editors attach to it, and saves report to it even after their editor is gone (N9). A ledger holds:
  - `lastKnown`: the person ids of the last value known to be stored in the cell. It is set from the stored (confirmed) value when the ledger is created, never from an unconfirmed draft (on Desktop, not from `store.pendingDataFor`, ES:400-405).
  - `ownAdded`: people this client added by its own confirmed saves since the last flush.
  - `picked`: person id → `requireNotification`, for people picked from the @ menu in this cell since the last flush (last pick wins; the value is the toggle at the moment of the pick, as in Desktop documents).
  - `sent`: person id → the strongest `require_notification` already sent from this ledger (`true` beats `false`).
  - `inFlight`: the number of saves issued and not yet resolved.

  `persons(delta)` is the set of non-empty string `person_id` values of the inserts whose sanitized mention (`RICH_TEXT_FORMAT.md` §9) has type `person`.
- **N7 (events).**
  - **Own save confirmed** with saved delta S: `ownAdded ∪= persons(S) − lastKnown`, then `lastKnown = persons(S)`. "Confirmed" means: on web, `writeCellToRow` returned `'written'`; on Desktop, `_persist` resolved `true` (ES:612-621).
  - **Outside value** E (remote sync, database undo or redo, reload; web: the incoming effect, `RichTextCellEditor.tsx:216-239`; Desktop: `_onCellData`, ES:681) is any value that is not the echo of an own save (R37b keeps echo detection working with labels): `lastKnown = persons(E)`. `ownAdded` is **not** touched.
  - **Own save refused or failed** (N10): nothing changes.
- **N8 (flush).** A flush sends to every person in
  `(ownAdded ∩ lastKnown ∩ keys(picked)) − self`,
  in sorted order, with `require_notification = picked[id]`, skipping a person when `sent[id]` is already at least as strong. At most `maxMentionNotificationsPerFlush` = 20 calls are made per flush (conformance `limits`); the rest are dropped with a logged warning. After the flush, `ownAdded` and `picked` are cleared and `sent` is updated.
  - Intersecting with `lastKnown` drops a person who was saved and then removed again, by this user (a later own save) or by anyone else (an outside value), before the flush. That covers database undo of a title mention (the undo arrives as an outside value) and a collaborator removing the mention.
  - Intersecting with `ownAdded` drops people someone else added: a collaborator's edit that adds Bob moves Bob into `lastKnown`, so a later own save that still contains Bob adds nothing.
  - Intersecting with `picked` drops everyone who was not picked from the @ menu in this cell: pasted people, people restored by an in-editor undo after their pick was flushed, and people carried in by any other path. This matches documents, which never notify on paste, and it keeps untrusted clipboard content from sending notifications in the user's name (section 3.3).
- **N9 (when to flush, and lifetime).**
  - **Cells** flush right after each confirmed save. A cell saves when it exits (Enter, Escape, click outside, blur, window blur, `pagehide`, unmount).
  - **Titles** save on every keystroke on web and 300 ms after typing stops on Desktop (`rich_text_cell_editor.dart:31, 419`). They flush at the end of a burst: when the title loses focus or leaves (Enter or Escape), or 1,000 ms after the last confirmed save (the web's `TITLE_UNDO_PAUSE_MS`, `RichTextCellEditor.tsx:113`).
  - **Disposal never cancels a send.** When the last editor detaches, the ledger flushes once `inFlight` reaches 0 (a Desktop `_commit(isDisposing: true)`, `rich_text_cell_editor.dart:550-555, 646-649`, or a web save deferred for page names, `RichTextCellEditor.tsx:368-381`, may resolve after the editor is gone). It is removed from the registry after that flush, unless an editor attached again meanwhile.
- **N10 (failed or refused saves).** A save that fails or is refused changes nothing and sends nothing. This covers:
  - a text over 10,000 bytes, or a delta over 200,000 bytes (`RichTextCellEditor.tsx:332-339`; ES:563-572);
  - a newer-format cell (`RICH_TEXT_FORMAT.md` R49; a no-op save is "confirmed" but adds nobody);
  - an editor crash (`RichTextCellEditor.tsx` crash path);
  - a Desktop backend error (`_persist` returns false, ES:612-621).

### 3.2 Paths that never notify

- **Undo or redo of a saved value** through database history (web `isDatabaseHistoryHotkey`, `RichTextCellEditor.tsx:523-526`; Desktop has no database undo). The restored value arrives as an outside value (N7).
- **Row duplicate.** `cloneDatabaseCell` / `duplicate_row` copy the cell.
- **Remote sync, offline edits made by other clients, import, server API, AI or MCP writes.** The client that made the edit is responsible, and the server path has no notification (`mention-server.md` §1).
- **Field type changes and template applications.**
- **Paste**, on both clients, including Desktop's `appendToRichTextCell` (`rich_text_cell_editor.dart:114`), which needs no ledger.

### 3.3 Paste

Pasted people are saved like any content but never notified (N8). Clipboard content is untrusted:
- Web decodes any `text/html` that carries a `data-slate-fragment` attribute (`web:.../rich-text-slate.ts:227-234`), and `pickMarks` keeps `mention` with any `person_id` and `person_name`. Desktop keeps pasted in-app JSON or HTML mentions (`rich_text_cell_paste.dart:274-301`).
- The displayed name comes from the stored `person_name`, which is independent of `person_id`, so a pasted "@Alice" could point at Bob.
- The server has no cap and no batch API, and each call creates a new event (`srv:libs/appflowy-cloud-core/src/biz/notification/service.rs:104`).

This replaces revision 1's rule, which notified pasted people under the stored preference.

### 3.4 Offline

- **Web.** The Yjs write succeeds locally and syncs later. The notification is an HTTP call, and it is not queued. If it fails, the error is logged and the N3 toast is shown when it asked for a notification. `sent` is not updated for a failed call. A retry queue is out of scope.
- **Desktop.** `MentionManager::update_page_mention` contacts the cloud first and returns an error offline (`mention_manager.rs:727-737`). The same toast rule applies. Local and vault workspaces return `local_version_not_support` (`flowy-server-local/src/impls/mention.rs:14-22`). The ledger MUST skip flushes (and clear `picked`) when `collaborationActionsEnabled` is false (`dt:lib/features/workspace/logic/workspace_state.dart:222-226`), as the menu already does (`mention_bloc.dart:220`).

## 4. Payload and target (cells and titles, both clients)

| Field | Value | Web source | Desktop source |
|---|---|---|---|
| path `view_id` | The database view the cell is shown in | `activeViewId ?? databasePageId` (`RichTextCellContext.tsx:25`; the same value as `useDatabaseViewId()`, `web:src/application/database-yjs/context.ts:422-426`) | `widget.databaseViewId ?? cellController.viewId` (`rich_text_cell_editor.dart:496`) |
| `person_id` | The mentioned person | | |
| `row_id` | The row | `rowId` | `cellController.rowId` |
| `block_id` | **omitted** (`null` on web; the `one_of` left unset on Desktop) | | |
| `is_row_document` | `false` | Sent explicitly | Computed by Rust (`mention_manager.rs:697`), and false for a database view |
| `view_name` | The row title, made safe by N11: the primary field's plain text after the save, or the placeholder if it is empty. For the row title editor this is the saved text itself. | `usePrimaryFieldId()` + `useCellSelector({rowId, fieldId: primaryFieldId})`, as `PersonCellMenu.tsx:32-43` does. Fallback `t('menuAppHeader.defaultNewPageName')`. | `rowDocumentTitle:` from the primary field's cell, loaded as `person_cell_bloc.dart:320-340` does (`_getRowTitle`). Fallback: `view_service.dart:479-481` already substitutes `document_title_placeholder`. |
| `view_layout` | The database view's layout | `loadViewMeta(viewId)?.layout`, as today | Set by Rust from the view (`mention_manager.rs:720`) |
| `ancestors` | Not sent (web), or set by Rust (Desktop) | Unchanged. The web type `string[]` (`workspace-api.ts:557`) does not match the server's `Vec<PageMentionAncestorViewInfo>` and MUST stay unset. | Built from `ancestor_id = viewId` (`mention_manager.rs:684-694`) |
| `require_notification` | Per N8 | | |

- **N11 (title length).** The row title can be up to 10,000 bytes. The server copies `page_name` into the FCM notification body and data (`srv:libs/appflowy-cloud-core/src/biz/notification/push.rs:155-166, 222-231`) and into the email subject, and FCM rejects payloads over 4 KB. Both clients MUST send `notificationTitle(rowTitle)`: replace every `\r\n`, `\r` or `\n` with one space, trim, use the localized placeholder if the result is empty, and if it is longer than 256 UTF-16 code units, cut it to the longest prefix of whole extended grapheme clusters that is at most 255 code units and append `…` (U+2026). Web uses `Intl.Segmenter` with `granularity: 'grapheme'`; Dart uses `package:characters`. The shared vectors are the conformance `notificationTitle` section.

This is the target the Person field already uses (`PersonCellMenu.tsx:73-85`: database view, `row_id`, `is_row_document: false`, `view_name: rowTitle || 'Untitled'`; `person_cell_bloc.dart:191-199`).

With `is_row_document: false`, the server checks permission with a `Document` object for the database view and does not log the row-document warning (`page_view.rs:11854-11864`). It stores `row_id` in the notification metadata, and the email link becomes `/app/{ws}/{view}?r={row_id}&is_desktop=true`, with no `blockId` because none is sent (`delivery.rs:247-283`).

- **N12 (no empty strings).** Desktop `ViewBackendService.updatePageMention` (`view_service.dart:465-491`) MUST set `blockId` and `rowId` only when they are non-null and non-empty:

  ```dart
  if (blockId != null && blockId.isNotEmpty) payload.blockId = blockId;
  if (rowId != null && rowId.isNotEmpty) payload.rowId = rowId;
  ```

  As a defense, Rust `update_page_mention` MUST map `Some("")` to `None` for both fields before it builds `PageMentionUpdate` (`mention_manager.rs:715-724`), so older Dart builds are fixed too.
- **N13.** The web cell path calls `WorkspaceService.updatePageMention` directly from the cell ledger. It does not go through `MentionPanel`, so the panel's `is_row_document: Boolean(rowId)` rule (`MentionPanel.tsx:945`) is never used for cells.
- **N14.** Desktop sends cell notifications through `RustMentionRepository.mentionPerson` (`rust_mention_repository.dart:298-324`) with `documentId: viewId`, `ancestorId: viewId`, `rowId`, `blockId: null`, `rowDocumentTitle: rowTitle` and `requireNotification` per N8. It does not go through `MentionBloc`, which belongs to the menu and may be closed by then.

## 5. Self-mentions

- **N15.** Both clients skip the current user before any network call: web (N4, in the document path and in the cell ledger, both failing closed when the user is unknown) and Desktop (already done in Rust, `mention_manager.rs:676-678`; the Dart ledger also skips it so that it does not count as sent). A self-mention is never recorded and never notified. Desktop has always behaved this way.

## 6. Deduplication

- **N16.**
  - **Within one flush:** each person once (a set).
  - **Across flushes of one ledger:** `sent` records the strongest `require_notification` already sent per person. A person is not sent again with the same or a weaker value. A record-only call (`require_notification: false`) does not block a later `true` call: if the user picks Ada with the toggle off, saves, then turns the toggle on, picks Ada again and saves, the second save notifies Ada, as Desktop documents would. A `false` call after a `true` call is skipped.
  - **Across ledgers:** only additions relative to `lastKnown`, which starts from the stored value, can be sent. Saving the same content again never notifies. Adding a person who was already in the cell's stored content never notifies.
  - A failed call does not update `sent`.
- **N17.** The server does not deduplicate: `notify_many` creates a new UUID for each event (`service.rs:104`). `af_page_mention` keeps one row per `(workspace, view, person)` (`srv:libs/database/src/workspace.rs:6707`), so every cell of a database shares that row, and the last `row_id` wins. Server-side idempotency is an optional addition (§9).

## 7. When `require_notification` is false

The client still calls the API (N3, N8), as Desktop does today. The server then:
- upserts `af_page_mention`, resetting `notified=false`;
- updates the last-mentioned cache, which re-ranks the picker for everyone;
- broadcasts `MentionablePersonListChangedPageMention` to the workspace (`page_view.rs:11971-` `update_page_mention`).

`resolve_mention_notification_recipient` returns early (`page_view.rs:11900-11902`), so there is no recipient, and no inbox item, push or email.

## 8. Inbox navigation

- **N18 (web).** `NotificationItem.handleClick` (`NotificationItem.tsx:200-208`) MUST open the row when the metadata has a non-empty string `row_id`:

  ```ts
  const rowId = typeof notification.metadata.row_id === 'string' && notification.metadata.row_id ? notification.metadata.row_id : undefined;
  await toView(notification.viewId, rowId ?? blockId);
  ```

  This works because `toView` already turns its second argument into `?r=<id>` for every database layout, and into `?blockId=` for documents (`web:src/components/app/hooks/useViewOperations.ts:489-507`). The server stores the governing database view as `viewId`, for cell mentions and for verified row documents alike (`page_view.rs:11985-12012`). So the same code also fixes row-document mentions on web. Their block anchor inside the row page is lost, which matches today's email link (`delivery.rs:266-272`). A follow-up could pass `blockId` through the row page.
- **N19 (Desktop).** No change. `RowDocumentNavigationContext.fromMetadata` uses the notification's `viewId` as the database view when `row_id` is present, and `buildNotificationNavigationActions` opens the row (`row_document_navigation_context.dart:38-60`; `notification_navigation_action.dart:22-58`). `_pickText` ignores empty strings (`:111-119`).

## 9. Optional API additions (not in these PRs)

| Addition | Purpose | Compatibility |
|---|---|---|
| `source: "database_cell"` in `PageMentionUpdate`, copied to the notification metadata | Lets the server and clients word the inbox item ("mentioned you in <row> · <field>"), and lets the server check permission on `ObjectRef{row_id, DatabaseRow}` instead of a `Document` object | `PageMentionUpdate` has no `deny_unknown_fields` (`srv:libs/appflowy-entity/src/database/dto.rs:2409-2424`), so old servers ignore it. The web can send it now. Desktop needs a new pinned `client-api` revision (the DTO lives in the pinned crate; pin at `rs:Cargo.toml:256` per `mention-desktop.md`), so it is deferred. |
| `field_id` | Deep-link to the cell, and a per-cell key for `af_page_mention` | Same as above. Clients ignore unknown metadata keys (`_pickText`). |
| `client_event_id` (UUID v5 of `ws/view/row/field/person/saved-delta-hash`) | Server-side idempotency: the writer already replays an identical event id safely (`libs/appflowy-notification/src/service.rs:291-307`, per `mention-server.md`) | Same as above. Requires `notify_many` to accept a caller-provided id. |

Recommendation: ship N1-N19 first. The additions need server work to be useful, and the client-side diff already removes the duplicates users would see.

## 10. The user's in-progress `MentionPanel` edits

- `MentionPanel.tsx:976-978` (uncommitted) adds `if (e.isComposing) return;` at the top of the panel's native keydown listener. This lets an IME confirm text without selecting a result. The new `__tests__/MentionPanel.test.tsx` (untracked) covers it with a composing Enter.
- **They address none of this design.** They do not change when, how or whether notifications are sent.
- They do help in two ways:
  - The new test file mocks `WorkspaceService` as `{}`, `CustomEditor.addMark`, the panel context and `useCurrentUserOptional`. It is the natural home for the N2-N5 tests. Its mocks need `WorkspaceService.updatePageMention: jest.fn()` and a current user, so that a person pick no longer throws when the module is resolved.
  - The uncommitted `RichTextCellEditor.test.tsx` replaces the `MentionPanel` mock with a stub that renders while a panel is active. Cell tests can use that stub to exercise the `onPersonMentionPicked` deferral without the real panel.
- Overlap risk: the N3-N5 edits touch `MentionPanel.tsx:916-972`, directly above the uncommitted hunk at 976-978. Rebase carefully.

## 11. Tests

| Client | Test |
|---|---|
| Web | `MentionPanel.test.tsx`: the toggle reads and writes `localStorage` (default off, survives a reload), and appears only with person results; a document pick sends `require_notification` = toggle; a self pick sends nothing; with no current user a pick sends nothing; a self id in a different case is still skipped; with `onPersonMentionPicked` in context, the pick calls it and sends nothing. |
| Web | New `rich-text/__tests__/cell-mention-ledger.test.ts` (pure ledger, N6-N10, N16): pick + save notifies once; paste of a person (not picked) never notifies; undo arriving as an outside value before a title flush cancels the send; a collaborator's edit that keeps Ada still lets Ada be notified; a collaborator's added Bob is never notified by our later save; record-only then `true` re-sends, `true` then `false` does not; at most 20 calls per flush; a refused or failed save changes nothing; disposal with a save in flight sends after the save resolves; the ledger starts from the stored value, not from a pending draft. |
| Web | `rich-text/__tests__/notification-title.test.ts`: the conformance `notificationTitle` section. |
| Web | `RichTextCellEditor.test.tsx`: a cell save with a picked person sends one PUT with `{view: dbView, row_id, block_id: null, is_row_document: false, view_name: notificationTitle(rowTitle)}`; a too-large draft sends nothing; a title burst sends once after the pause; a mention added and removed within a burst sends nothing; saving a new mention (which adds its `label`) does not replace the editor or move the caret (R37b). |
| Web | `NotificationItem` test: a `row_id` in metadata calls `toView(viewId, rowId)`. |
| Web | Playwright BDD `playwright/bdd/steps/text-cell-rich-text.steps.ts`: mention a person in a cell, save, intercept the PUT, assert the payload; inbox click opens `?r=`. |
| Desktop | `rich_text_cell_menus_test.dart:94-99`: change to "picking a person records an intent and calls nothing"; add "saving calls `mentionPerson` once with the row title". The fake repository (`rich_text_cell_menu_helpers.dart:117-128`) must record `requireNotification`. |
| Desktop | New `test/unit_test/database/rich_text_cell_mention_ledger_test.dart`: the same cases as the web ledger test, plus `collaborationActionsEnabled=false` and "a save that resolves after `dispose()` still notifies". |
| Desktop | `test/unit_test/database/rich_text_notification_title_test.dart`: the conformance `notificationTitle` section. |
| Desktop | `view_service` payload test: null and empty `blockId`/`rowId` leave the `one_of` unset. Rust unit test: `update_page_mention` maps `Some("")` to `None`. |
