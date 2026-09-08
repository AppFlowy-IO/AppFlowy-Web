# Database Feed view Flutter parity

This document maps the Flutter Desktop Feed implementation and its tests in
`AppFlowy-Premium/frontend/appflowy_flutter` to the Web implementation in
`src/components/database/feed`. The Flutter widget code is authoritative. This comparison uses desktop commit
`9c3d180734ca2e3587a2a428f9d1ee46b59f9e98` and its pinned AppFlowy Client
`26e82f98be4f23817756401586f7c14e477355cf`. The desktop design guides include
proposed controls that are absent from this runtime; they are not the parity contract.

## Desktop sources

- `plugins/database/feed/application/feed_bloc.dart` — row loading, in-memory
  newest-first ordering when the view has no sorts, 20/10 incremental rendering,
  create/duplicate/delete, per-row expand state.
- `plugins/database/feed/application/feed_card_bloc.dart` — creator lookup,
  comments summary, row reactions.
- `plugins/database/feed/presentation/desktop_feed_page.dart` — card list,
  load-more button, trailing add-row button, empty state, row detail opening.
- `plugins/database/feed/presentation/widgets/feed_card.dart` — cover, creator
  row (avatar, name, date, `(edited)`), title with icon, document preview,
  reactions, comment summary / add-comment input, hover actions.
- `plugins/database/feed/presentation/widgets/feed_document_preview.dart` —
  read-only document capped at 120px with See more / See less.
- `plugins/database/feed/presentation/widgets/feed_setting_bar.dart` — filter,
  sort, search, settings, new row.
- `rust-lib/flowy-database2/src/services/database_view/layout_deps.rs` — a new
  Feed view shows only the primary field and gets a CreatedTime-descending sort
  when the database has a CreatedTime field.
- `widgets/setting/database_settings_list.dart` — Feed settings expose only the
  layout switcher.

## Data model

- `DatabaseViewLayout.Feed = 6` (`libs/collab/src/database/views/layout.rs`),
  `ViewLayout.Feed = 8` (folder side), document block type `feed`.
- Row reactions live on the row document meta map under `row_reactions` as
  `{"emoji": [i64 uid, ...]}`. `src/application/database-yjs/row_reaction.ts`
  parses and serializes those ids without losing precision.
- Comments are the existing row comment map; feed cards only observe it and
  never create it.

## Web mapping

| Desktop | Web |
| --- | --- |
| `FeedBloc.didLoadRows` in-memory `createdAt` desc sort | `useFeedRowOrders` (`sortFeedRowsByCreatedAt`) using the shared background row loader |
| `kInitialVisibleRows` / `kLoadMoreRowsIncrement` | `FEED_INITIAL_ROW_LIMIT` (20) / `FEED_LOAD_MORE_INCREMENT` (10) |
| `DatabaseLoadMoreButton` | `FeedLoadMore` |
| `_AddRowButton` (`feedAddRowButtonKey`) | `FeedNewRow` (`feed-new-row`), creates a trailing row and opens its detail page |
| `LocaleKeys.feed_noItemsInFeed` | `FeedEmptyState` (`feed-empty`) |
| `FeedCard` | `FeedCard` (`feed-card-<rowId>`), click opens the row detail page |
| `_buildCreatorInfo` | `FeedCreatorInfo` (`feed-card-creator-<rowId>`), `(edited)` after 60s |
| `FeedDocumentPreview` (120px, See more) | `FeedDocumentPreview` rendering a detached mirror of the row document |
| `FeedRowReactions` / `AddReactionChip` | `FeedRowReactions` (`feed-row-reaction-<rowId>-<emoji>`) |
| `_buildCommentSummary` / `AddCommentInput` | `FeedCommentSection` (`feed-comment-summary-<rowId>` / `feed-add-comment-*`) |
| hover emoji + more buttons | `FeedCardActions` (`feed-card-reaction-button-*`, `feed-card-more-*`) |
| `FeedSettingBar` | `DatabaseActions` shows filter, sort, search, settings and New for Feed |
| `DatabaseSettingAction.showLayout` only | `FeedSettings` |
| `LinkedViewLayoutDependencies` for Feed | `normalizeCreatedDatabaseFeedView` in `feed-layout.ts` |

The document preview cannot bind a second editor to the live row document:
every editor on the same Y.Doc ignores transactions tagged with the shared
`CollabOrigin.Local` origin, so edits made in the row detail page would never
reach the card. `createMirroredPreviewDoc` re-applies source updates into a
detached read-only doc under a distinct origin instead.

## Feed settings and card settings

| Control | Desktop runtime | Web |
| --- | --- | --- |
| Feed settings menu | Layout only (`actionsForDatabaseLayout(Feed)`) | `FeedSettings` exposes Layout only; browser checks switching into and out of Feed |
| Card menu | Duplicate and Delete, with deletion confirmation | Same actions in `FeedCardActions`; menu clicks do not open row detail |
| Card cover and icon | `showCover: true`, `showIcon: true` | Always follows row metadata, including edits/removals; no separate card-settings dialog |
| Preview | 120px collapsed, See more/less, linked databases | Same; embedded databases have finite height and nested Feed cards cannot load another preview |
| Comments | Text, attachments, mentions and reply summary | Shared `CommentComposer` on Feed and row detail; preserves unsaved drafts and IME composition |
| Row reactions | Add in Feed, display/toggle in row detail; no add chip under Comments | Same numeric-user-ID row metadata on both surfaces |
| New row | Trailing button and toolbar New/template dropdown | Both create/open rows, including while filtered or sorted; default templates apply in Feed |

Preview loads carry database/view/row authorization context, acquire a realtime sync owner,
and mirror source updates into a separate Y.Doc. Document editors, headings and table cells
have separate DOM identities. Only matching cards near the viewport mount document previews.

Comment attachments use the desktop JSON fields `id`, `name`, `url`, `file_type`, `size`,
and `uploaded_at`. Web uploads files to workspace storage, displays image thumbnails, and
downloads protected files with authentication. Desktop attachments stored only at device-local
paths remain named attachments; a browser cannot access another device's local files.
Mentions serialize as `@[name](person_uuid)` and use the same row-comment notification API
as Desktop. Editing only notifies newly mentioned people; failed notification delivery does
not discard the saved comment.

## Test migration

All **53 dedicated desktop Feed cases** are mapped below. Equivalent cases share a stronger
browser scenario where appropriate (for example, the two creator tests and the five
100-row loading tests). The four Feed BDD scenarios are preserved, including linked Grid
height and navigation out of a row-detail dialog.

Desktop `.afdb` fixture import is native-only. Web tests seed real row collabs through the
existing test bridge: known text/number/checkbox/select/date values for conditions, and
**100 rows** for the loading boundary. Browser tests then exercise the production controls,
row-detail editing, view switching, ordering and persistence. Desktop anonymous sign-in
is adapted to isolated Web test accounts. The cloud linked-picker scenario uses a
catalog response with the desktop legacy shape instead of its pre-seeded account;
link creation and database rendering still use real authorized collabs.

### `database_feed_basic.dart` (2 cases)

| Desktop case | Web scenario |
| --- | --- |
| feed view can be created from grid tab bar | [feed view can be created from grid tab bar](e2e/database/feed-view-core.spec.ts) |
| feed view shows rows sorted by created time descending | [feed view shows rows sorted by created time descending](e2e/database/feed-view-core.spec.ts) |

### `database_feed_card_actions_test.dart` (5 cases)

| Desktop case | Web scenario |
| --- | --- |
| feed card displays with default rows | [a new Feed page shows the three default cards](e2e/database/feed-view-core.spec.ts) |
| more button appears on hover and shows menu | [clicking the more button does not open row detail](e2e/database/feed-view-core.spec.ts) |
| duplicate row from more menu increases row count | [more menu duplicates and deletes a card](e2e/database/feed-view-core.spec.ts) |
| delete row from more menu decreases row count | [more menu duplicates and deletes a card](e2e/database/feed-view-core.spec.ts) |
| clicking more button does not open row detail | [clicking the more button does not open row detail](e2e/database/feed-view-core.spec.ts) |

### `database_feed_card_creator_test.dart` (2 cases)

| Desktop case | Web scenario |
| --- | --- |
| newly created row shows creator avatar | [new creator avatar persists after navigating away and back](e2e/database/feed-view-social.spec.ts) |
| creator avatar persists after navigating away and back | [new creator avatar persists after navigating away and back](e2e/database/feed-view-social.spec.ts) |

### `database_feed_comment_test.dart` (3 cases)

| Desktop case | Web scenario |
| --- | --- |
| add a comment with text from feed card | [adding a comment from the card shows the reply summary](e2e/database/feed-view-core.spec.ts) |
| add a comment with attachment from feed card | [attach a file from the Feed card and read it in row detail](e2e/database/feed-view-social.spec.ts) |
| feed card shows comment summary after adding comment | [adding a comment from the card shows the reply summary](e2e/database/feed-view-core.spec.ts) |

### `database_feed_filter_and_sort_test.dart` (9 cases)

| Desktop case | Web scenario |
| --- | --- |
| apply filter and sort in either order | [apply filter and sort in either order](e2e/database/feed-view-conditions-parity.spec.ts) |
| delete filter or sort while the other remains active | [delete filter or sort while the other remains active](e2e/database/feed-view-conditions-parity.spec.ts) |
| change filter condition with active sort in feed view | [change filter condition with active sort in feed view](e2e/database/feed-view-conditions-parity.spec.ts) |
| change sort direction with active filter in feed view | [change sort direction with active filter in feed view](e2e/database/feed-view-conditions-parity.spec.ts) |
| new matching card appears with filter and sort active | [new matching card appears in correct sorted position with filter and sort active](e2e/database/feed-view-conditions-parity.spec.ts) |
| new matching card is placed in correct sorted position with filter and sort | [new matching card appears in correct sorted position with filter and sort active](e2e/database/feed-view-conditions-parity.spec.ts) |
| edit row to match filter shows it in feed view | [edit row to match filter shows it in feed view with active sort](e2e/database/feed-view-conditions-parity.spec.ts) |
| empty then non-empty filter results with sort in feed view | [empty then non-empty filter results with sort in feed view](e2e/database/feed-view-conditions-parity.spec.ts) |
| cross-field filter/sort combinations in feed view | [cross-field filter/sort combinations in feed view](e2e/database/feed-view-conditions-parity.spec.ts) |

### `database_feed_filter_test.dart` (14 cases)

| Desktop case | Web scenario |
| --- | --- |
| create text filter in feed view | [create text filter in feed view excludes empty names](e2e/database/feed-view-conditions-parity.spec.ts) |
| create checkbox filter in feed view | [create checkbox filter in feed view](e2e/database/feed-view-conditions-parity.spec.ts) |
| create select option filter in feed view | [create select option filter in feed view](e2e/database/feed-view-conditions-parity.spec.ts) |
| delete filter restores all cards in feed view | [a text filter narrows the cards and deleting it restores them](e2e/database/feed-view-filter-sort.spec.ts) |
| change filter condition updates feed | [change filter condition updates feed](e2e/database/feed-view-conditions-parity.spec.ts) |
| new row matching filter appears in feed | [new row matching filter appears in feed](e2e/database/feed-view-conditions-parity.spec.ts) |
| edit row to match filter makes it appear | [edit row to match filter makes it appear](e2e/database/feed-view-conditions-parity.spec.ts) |
| edit row to not match filter hides it | [edit row to not match filter hides it](e2e/database/feed-view-conditions-parity.spec.ts) |
| filter persists when switching to grid and back | [filter persists when switching to grid and back; filter is isolated per view](e2e/database/feed-view-conditions-parity.spec.ts) |
| filter is isolated per view | [filter persists when switching to grid and back; filter is isolated per view](e2e/database/feed-view-conditions-parity.spec.ts) |
| checkbox filter - unchecked condition | [checkbox filter - unchecked condition](e2e/database/feed-view-conditions-parity.spec.ts) |
| select option filter - OptionIsNot condition | [select option filter - OptionIsNot condition](e2e/database/feed-view-conditions-parity.spec.ts) |
| select option filter - OptionIsEmpty condition | [select option filter - OptionIsEmpty condition](e2e/database/feed-view-conditions-parity.spec.ts) |
| select option filter - OptionIsNotEmpty condition | [select option filter - OptionIsNotEmpty condition](e2e/database/feed-view-conditions-parity.spec.ts) |

### `database_feed_load_more.dart` (5 cases)

| Desktop case | Web scenario |
| --- | --- |
| import list.afdb and verify grid shows rows | [import-equivalent 100 rows, load every card, switch views and create a row](e2e/database/feed-view-load-more.spec.ts) |
| feed view shows imported rows | [import-equivalent 100 rows, load every card, switch views and create a row](e2e/database/feed-view-load-more.spec.ts) |
| create new row in feed view increases count | [import-equivalent 100 rows, load every card, switch views and create a row](e2e/database/feed-view-load-more.spec.ts) |
| scroll through feed view loads all 100 rows | [import-equivalent 100 rows, load every card, switch views and create a row](e2e/database/feed-view-load-more.spec.ts) |
| switching between grid and feed shows rows consistently | [import-equivalent 100 rows, load every card, switch views and create a row](e2e/database/feed-view-load-more.spec.ts) |

### `database_feed_sort_test.dart` (13 cases)

| Desktop case | Web scenario |
| --- | --- |
| create ascending sort in feed view | [create ascending and descending sorts in feed view keep empty names last](e2e/database/feed-view-conditions-parity.spec.ts) |
| create descending sort in feed view | [create ascending and descending sorts in feed view keep empty names last](e2e/database/feed-view-conditions-parity.spec.ts) |
| sort by number field in feed view | [sort by Score field in feed view](e2e/database/feed-view-conditions-parity.spec.ts) |
| sort by checkbox field in feed view | [sort by Completed field in feed view](e2e/database/feed-view-conditions-parity.spec.ts) |
| sort by select option field in feed view | [sort by Choice field in feed view](e2e/database/feed-view-conditions-parity.spec.ts) |
| delete sort in feed view | [delete sort in feed view restores newest-first order](e2e/database/feed-view-conditions-parity.spec.ts) |
| change sort direction in feed view | [a persisted sort replaces the newest-first order and can flip direction](e2e/database/feed-view-filter-sort.spec.ts) |
| new row appears in feed with active sort | [new row appears in feed with active sort](e2e/database/feed-view-conditions-parity.spec.ts) |
| edit row in feed updates sorted position | [edit row in feed updates sorted position](e2e/database/feed-view-conditions-parity.spec.ts) |
| create multiple sorts in feed view | [create multiple sorts in feed view](e2e/database/feed-view-conditions-parity.spec.ts) |
| sort persists when switching views | [sort persists when switching views; sort is isolated per view](e2e/database/feed-view-conditions-parity.spec.ts) |
| sort is isolated per view | [sort persists when switching views; sort is isolated per view](e2e/database/feed-view-conditions-parity.spec.ts) |
| sort by date field in feed view | [sort by Date field in feed view](e2e/database/feed-view-conditions-parity.spec.ts) |

## BDD and shared desktop cases

| Desktop source and case | Web coverage |
| --- | --- |
| `bdd/database/feed/feed.feature`: row content in Feed and linked Feed | Same scenario in [feed.feature](bdd/features/database/feed.feature) |
| `feed.feature`: linked Grid renders with bounded expandable height | Same scenario in [feed.feature](bdd/features/database/feed.feature) |
| `feed.feature`: View database closes row detail | Same scenario in [feed.feature](bdd/features/database/feed.feature) |
| `feed.feature`: View database works in a normal document | Same scenario in [feed.feature](bdd/features/database/feed.feature) |
| `bdd/database/readonly/readonly.feature`: Feed controls are readonly | [feed-readonly.feature](bdd/features/database/feed-readonly.feature) |
| `database/database_row_reaction_test.dart`: Feed reactions visible in detail; toggling the same emoji; multiple emojis; changes sync back; add chip hidden in detail | All five in [feed-view-social.spec.ts](e2e/database/feed-view-social.spec.ts), “multiple emojis toggle and sync between Feed and row detail” |
| `grid/grid_row_template_test.dart`: default template applies from New across layouts, Feed branch | [row-template.spec.ts](e2e/database/row-template.spec.ts), “the default template applies from the top-right New button in every supported database view” includes Feed |
| `sidebar/sidebar_test.dart`: create each layout, Feed branch | [feed-view-core.spec.ts](e2e/database/feed-view-core.spec.ts), standalone Feed creation from the sidebar |
| `document/document_with_database_test.dart`: picker lists container, excludes Grid/Gallery/Feed children | [feed-view-document.spec.ts](e2e/database/feed-view-document.spec.ts), linked-picker container scenario |
| `bdd/document/cloud_linked_grid_picker.feature`: container-less template database remains linkable | [feed-view-legacy-picker.spec.ts](e2e/database/feed-view-legacy-picker.spec.ts) adapts the cloud catalog fixture with real database IDs; [workspace-database-catalog.test.ts](../src/application/services/js-services/__tests__/workspace-database-catalog.test.ts) checks standalone/container/embedded exclusions |

Additional Web regressions cover preview recursion, authorization, realtime owner cleanup,
viewport/search gating, editor identity isolation, IME input, unavailable-row draft retention,
attachment upload failures and authenticated downloads, mention identity and cursor position through text edits, attachment wire compatibility,
and notification failure after saving. Existing row-comment CRUD browser cases validate the
shared input in row detail.

Run the browser cases with `pnpm exec playwright test 'playwright/e2e/database/feed-view-.*'`
and BDD with `pnpm test:e2e:bdd:feed`. The database CI shards include the Feed browser specs;
the BDD matrix includes both Feed feature files. Validation results belong in the PR.
