# Database List view Flutter parity

This audit maps the live Flutter List implementation in
`AppFlowy-Premium/frontend/appflowy_flutter` to Web coverage. The Flutter widget
code is authoritative; the older `docs/list_view_integration_guide.md` contains
display-mode/card examples that are not rendered by the current desktop UI.

## UI and data contracts

- `DesktopListPage`, `ListRow`, `ListRowActions`, and
  `desktopListCardCellStyleMap` define the desktop layout, spacing, typography,
  hover controls, icon/document priority, property cells, and row actions.
- `ListBloc` defines filtered/sorted rows, 50-row incremental rendering,
  grouping, collapse, group row creation, and layout-setting notifications.
- List field visibility is persisted in per-view field settings. Desktop
  runtime compares each field's absolute ordered index with a three-field
  cutoff, then always shows the primary field. A normal primary-first view
  therefore shows the primary plus two non-primary fields; a primary ordered
  after the cutoff is shown in addition to the first three fields. The Flutter
  integration test's “3 properties” name and “first 3 non-primary” comment are
  not an executable count assertion; that test only verifies that at least one
  field is hidden.
- List grouping is independent of Board/Grid grouping and stores
  `hide_empty_groups` in List layout slot `4`.

## Dedicated Flutter integration suites

The inventory below distinguishes dedicated live List coverage from shared,
layout-agnostic engine contracts. The latter validate filter, sort, grouping,
and row semantics used by every database layout, while a smaller set of live
List flows validates the List wiring. It is behavioral coverage, not a claim
that every Flutter scenario has a one-for-one List Playwright test; remaining
live-parity gaps are called out explicitly.

| Flutter suite                                | Source scenarios                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Web coverage                                                                                                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database_list_basic.dart`                   | creates database container structure when created from sidebar; list view can be created from grid tab bar; list view displays rows correctly; switching between Grid and List layouts works; list view persists after navigation; create list view from board works                                                                                                                                                                                                                                                                                                                               | Creation/routing Jest contracts; live standalone creation and Grid-to-List tab switching in `list-view.spec.ts`; Board conversion is a dispatch unit, with no dedicated navigation-persistence Playwright case                                |
| `database_list_default_visibility_test.dart` | creating list view should show only 3 properties and hide others; toggling hidden fields makes them visible in list view                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Absolute-order cutoff Jest cases (primary first, primary after cutoff, and stale orders) plus one live List Properties visibility-toggle flow                                                                                                 |
| `database_list_field_display.dart`           | list view shows visible fields; list view has settings button with properties option; changing field visibility affects list display; list view displays multiple field types correctly; list view shows row icon and document indicator                                                                                                                                                                                                                                                                                                                                                           | `ListCell`, `ListRow`, and settings component contracts cover field rendering/order; live coverage is limited to default property visibility and the icon/document representative flow                                                        |
| `database_list_filter_and_sort_test.dart`    | apply filter and sort in either order; delete filter or sort while the other remains active; change filter condition with active sort in list view; change sort direction with active filter in list view; new matching row appears with filter and sort active; new matching row is placed in correct sorted position with filter and sort; edit row to match filter shows it in list view; empty then non-empty filter results with sort in list view; cross-field filter/sort combinations in list view                                                                                         | Shared `filter.test.ts`, `sort.test.ts`, and condition-selector contracts cover layout-agnostic permutations; one live List text-filter/text-sort flow covers direction change and filter deletion                                            |
| `database_list_filter_test.dart`             | create text filter in list view; create checkbox filter in list view; create select option filter in list view; delete filter restores all rows in list view; change filter condition updates list; new row matching filter appears in list; edit row to match filter makes it appear; edit row to not match filter hides it; filter persists when switching to grid and back; filter is isolated per view; checkbox filter - unchecked condition; select option filter - OptionIsNot condition; select option filter - OptionIsEmpty condition; select option filter - OptionIsNotEmpty condition | Shared filter-engine tests cover text/checkbox/select conditions and cell-update re-evaluation; the only dedicated live List case is text-contains plus deletion while sorted—no List-specific checkbox/select, mutation, or isolation matrix |
| `database_list_grouping_test.dart`           | list shows group headers and remove grouping option; add row in group footer increases group count; remove grouping clears list headers and hides action; board grouping does not carry over to list layout and remove grouping is hidden                                                                                                                                                                                                                                                                                                                                                          | List grouping dispatch/component units cover add/remove and Board conversion; the live BDD covers grouping, group hide/show, and hide-empty persistence, not every Flutter grouping operation                                                 |
| `database_list_load_more.dart`               | import list.afdb and verify grid shows rows; list view shows imported rows; create new row in list view increases count; scroll through list view loads all 100 rows; switching between grid and list shows rows consistently                                                                                                                                                                                                                                                                                                                                                                      | `List.test.tsx` covers the 50-to-100-row batching contract; there is no dedicated List import or live 100-row scroll Playwright flow                                                                                                          |
| `database_list_property_order_test.dart`     | leading property respects visibility and renders before primary field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `list.utils.test.ts` and `ListRow.test.tsx` cover leading/primary/trailing ordering; no Properties-reorder Playwright case                                                                                                                    |
| `database_list_row_icon_test.dart`           | row icon should be visible in list view after adding emoji; document indicator should appear in list view after adding content; emoji hides document indicator in list row (emoji takes priority); row icon should persist in list view after navigating away and back; row icon should update in list view when changed in row detail; list view parity with grid view - both show emoji                                                                                                                                                                                                          | Metadata component units cover indicator priority; one live List flow creates document content then adds an emoji, but does not cover navigation persistence or Grid/List icon parity                                                         |
| `database_list_row_operations.dart`          | create row in list view; click row opens row detail page; delete row from list view updates both views; duplicate row from list view updates both views; edit cell in grid reflects in list view                                                                                                                                                                                                                                                                                                                                                                                                   | `ListRowActions` units cover creation/insertion/duplicate/delete; the live flow covers open, duplicate, delete, and cross-view row counts, but not direct List creation or a post-mount Grid edit                                             |
| `database_list_sort_test.dart`               | create ascending sort in list view; create descending sort in list view; sort by number field in list view; sort by checkbox field in list view; sort by select option field in list view; delete sort in list view; change sort direction in list view; new row appears in list with active sort; edit row in grid updates list view with sort; create multiple sorts in list view; sort persists when switching views; sort is isolated per view; sort by date field in list view                                                                                                                | Shared sort-engine tests cover text/number/checkbox/select/date and multi-sort semantics; one live List text-sort flow covers ascending/descending only—no type, mutation, persistence, or isolation matrix                                   |

The 11 files above contain 70 dedicated Flutter `testWidgets` cases.

## BDD and cross-layout cases

| Flutter source                                                             | Web destination                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `desktop/bdd/database/list_group_visibility/list_group_visibility.feature` | `playwright/bdd/features/database/list-group-visibility.feature` and matching steps                                |
| List portions of `desktop/bdd/database/readonly/readonly.feature`          | Focused readonly component contracts; see the readonly coverage note below                                         |
| `desktop/document/document_linked_list_test.dart`                          | Embedded linked List Playwright flow and viewport tests                                                            |
| List portion of `desktop/database/database_view_display.dart`              | Shared cell renderer plus focused `ListCell` compact-style contracts; no all-field List Playwright case            |
| List portion of `desktop/grid/grid_row_template_test.dart`                 | Layout-agnostic row-template dispatch unit includes List; existing row-template Playwright is not extended to List |

### Readonly List coverage and live-test blocker

Flutter's readonly BDD uses the test-only `setCurrentDatabaseReadonly()` hook to
flip the mounted database controller between editable and readonly states. Web
does not expose an equivalent UI or Playwright fixture for changing the active
database permission in place. A published database is reliably readonly, but it
uses the Publish variant and a different row-document path, so it is not an
equivalent test of the app permission transition or readonly row-detail modal.

The corresponding Web contracts are covered directly by:

- `List.test.tsx`: hides `list-new-row` and disables row reordering when
  `useReadOnly()` is true.
- `ListRow.test.tsx`: removes row action controls while preserving the stable
  leading slot in readonly mode.
- `ListGroup.test.tsx`: hides group mutation/new-row actions while keeping the
  non-mutating collapse control.
- `DatabaseRowSubDocument.test.tsx`: propagates `readOnly=true`,
  `canWrite=false`, and inherited comment access into the row document editor.

No live readonly List BDD is claimed until Web has a deterministic permission
fixture or UI path that exercises the same mounted app database context.

## Required validation

- Targeted List and generic grouping Jest suites.
- Generated Playwright BDD suite for List group visibility.
- List Playwright suites plus existing Grid grouping, filter, sort, row lifecycle,
  embedded database, and row-template regressions.
- `pnpm lint` and `pnpm build`.
