# Database List view Flutter parity

This document maps the current Flutter Desktop List implementation and tests in
`AppFlowy-Premium/frontend/appflowy_flutter` to the Web implementation. The
Flutter widget code is authoritative; older design notes that describe card
display modes are not used by the current Desktop List renderer.

## Desktop UI contracts

The Web renderer was checked against these Flutter sources:

- `plugins/database/list/presentation/desktop_list_page.dart`
- `plugins/database/list/presentation/widgets/list_row.dart`
- `plugins/database/list/presentation/widgets/list_row_actions.dart`
- `plugins/database/list/presentation/widgets/list_layout_constants.dart`
- `plugins/database/list/presentation/widgets/list_group_widgets.dart`
- `plugins/database/widgets/group/group_header.dart`
- `plugins/database/widgets/database_load_more_button.dart`
- `plugins/database/widgets/card/desktop_list_card_cell_style.dart` and its
  compact cell skeletons

The migrated contracts include:

- 36px rows, a 40px leading action slot, 20x30 action controls, a 200px row
  action menu with an 8px offset, a 32px load-more control, and a 40px footer;
- 44px group headers, 36px grouped rows, 12px group separation, collapse,
  visibility, group-row creation, and readonly mutation suppression;
- Desktop typography, compact checkbox/select/media/time/checklist/person/
  relation/rollup rendering, and token-based select colors;
- emoji before document-indicator priority, `Untitled` fallback, comments next
  to the title, row-detail navigation, and keyboard row opening;
- a 30px loading inset with standalone vertical centering and embedded
  shrink-wrapping;
- 50-row incremental rendering and the Desktop 200px load threshold;
- no grouped row drag-and-drop, matching Flutter Desktop.

List defaults use each field's absolute ordered index: positions 0 through 2
are visible and the primary field is always visible. With the normal
primary-first order this means primary plus two properties. List grouping is
independent from Grid and Board and stores `hide_empty_groups` in layout slot
`4`.

## Dedicated Flutter List suites

The 11 dedicated Flutter files contain 70 `testWidgets` cases. Sixty-nine have
direct executable Web destinations. The remaining case imports Flutter's raw
`.afdb` fixture; Web has no importer for that file format, so its observable
100-row List behavior is exercised with an equivalent Web-created database.

| Flutter suite                                | Cases | Web destination                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `database_list_basic.dart`                   |     6 | `list-view.spec.ts` and `list-view-live-flutter-parity.spec.ts`: standalone container/child metadata, Grid-to-List creation, row display/editing, Grid/List switching, outline-container navigation persistence, and Board-to-List                                                                           |
| `database_list_default_visibility_test.dart` |     2 | `useAddDatabaseView.test.tsx` and `useGroup.test.tsx` for absolute-index initialization, plus `list-view-live-flutter-parity.spec.ts` for the mounted default and showing every initially hidden property through Properties                                                                                 |
| `database_list_field_display.dart`           |     5 | `ListRow.test.tsx`, `ListCell.test.tsx`, `ListSettings.test.tsx`, and the live all-field Properties/List flow                                                                                                                                                                                                |
| `database_list_filter_and_sort_test.dart`    |     9 | Identically named cases in `list-filter-sort-desktop-parity.test.ts`, plus live toolbar and filtered-out-row-to-sorted-insertion flows in `list-view.spec.ts` and `list-view-state-parity.spec.ts`                                                                                                           |
| `database_list_filter_test.dart`             |    14 | Identically named engine cases plus live persistence/isolation in `list-view-state-parity.spec.ts`                                                                                                                                                                                                           |
| `database_list_grouping_test.dart`           |     4 | Four exact Playwright BDD scenarios in `list-group-visibility.feature`                                                                                                                                                                                                                                       |
| `database_list_load_more.dart`               |     5 | Four portable behaviors execute in `List.test.tsx` and `list-view-live-flutter-parity.spec.ts`: 50-to-100 batching, threshold, 100-to-101 creation, and Grid/List count consistency. The raw `.afdb` import mechanic is unsupported; the live test builds equivalent 100-row data through Web UI/test setup. |
| `database_list_property_order_test.dart`     |     1 | `ListRow.test.tsx` plus live Properties drag, leading-field geometry/order, hide, view-switch persistence, and reload persistence                                                                                                                                                                            |
| `database_list_row_icon_test.dart`           |     6 | `list-view.spec.ts` and `list-view-live-flutter-parity.spec.ts`: emoji, document marker, priority, outline-navigation persistence, replacement, and Grid/List equality                                                                                                                                       |
| `database_list_row_operations.dart`          |     5 | `list-view.spec.ts`: create, open, delete, duplicate, and post-mount Grid edit reflected in List                                                                                                                                                                                                             |
| `database_list_sort_test.dart`               |    13 | Identically named engine cases plus live persistence/isolation, direction changes, and mounted sort deletion                                                                                                                                                                                                 |

The 36 filter, sort, and filter-plus-sort cases are one-to-one input/result
migrations through the production filtering and sorting functions; the
persistence subset uses view-owned Yjs arrays. Representative Playwright flows
prove the mounted List toolbar, per-view persistence/isolation, direction and
deletion changes in both directions (delete sort while keeping filter, then
delete filter while keeping sort), and reactive row insertion after a
row-detail edit. They are not 36 duplicated browser-menu scenarios.

### Exhaustive 70-case inventory

The following audit uses the exact `testWidgets` names from the 11 Flutter
Desktop List files. A destination marked "engine" is an identically named Jest
case in `src/application/database-yjs/__tests__/list-filter-sort-desktop-parity.test.ts`.

#### `database_list_basic.dart` — 6/6

| Flutter case                                                     | Executable Web destination                                                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `creates database container structure when created from sidebar` | `list-view.spec.ts`: standalone List container, sole List child, persisted child ID, reload, and absence of a Grid tab                  |
| `list view can be created from grid tab bar`                     | `list-view.spec.ts`: Grid-to-List creation                                                                                              |
| `list view displays rows correctly`                              | `list-view.spec.ts`: two rows edited through row detail and rendered in List                                                            |
| `switching between Grid and List layouts works`                  | `list-view.spec.ts`: bidirectional switch with equal row counts                                                                         |
| `list view persists after navigation`                            | `list-view.spec.ts` and `list-view-live-flutter-parity.spec.ts`: leave, reload, normal outline navigation, same List child and row icon |
| `create list view from board works`                              | `list-view.spec.ts`: Board-to-List creation and return to Board                                                                         |

#### `database_list_default_visibility_test.dart` — 2/2

| Flutter case                                                       | Executable Web destination                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `creating list view should show only 3 properties and hide others` | `List.test.tsx`, `useGroup.test.tsx`, and mounted `list-view.spec.ts` absolute-index/default-visibility assertions |
| `toggling hidden fields makes them visible in list view`           | `List.test.tsx` and mounted Properties toggles in `list-view.spec.ts` / `list-view-live-flutter-parity.spec.ts`    |

#### `database_list_field_display.dart` — 5/5

| Flutter case                                           | Executable Web destination                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `list view shows visible fields`                       | `ListRow.test.tsx`                                                                  |
| `list view has settings button with properties option` | `ListSettings.test.tsx`                                                             |
| `changing field visibility affects list display`       | `List.test.tsx` plus mounted Properties toggles                                     |
| `list view displays multiple field types correctly`    | `ListCell.test.tsx` plus the live all-supported-field Properties flow               |
| `list view shows row icon and document indicator`      | `ListRow.test.tsx` plus mounted icon/document-priority flows in `list-view.spec.ts` |

#### `database_list_filter_test.dart` — 14/14

All 14 have identically named engine cases. The persistence/isolation and
reactive-edit subset additionally runs through mounted List views in
`list-view-state-parity.spec.ts`.

1. `create text filter in list view`
2. `create checkbox filter in list view`
3. `create select option filter in list view`
4. `delete filter restores all rows in list view`
5. `change filter condition updates list`
6. `new row matching filter appears in list`
7. `edit row to match filter makes it appear`
8. `edit row to not match filter hides it`
9. `filter persists when switching to grid and back`
10. `filter is isolated per view`
11. `checkbox filter - unchecked condition`
12. `select option filter - OptionIsNot condition`
13. `select option filter - OptionIsEmpty condition`
14. `select option filter - OptionIsNotEmpty condition`

#### `database_list_sort_test.dart` — 13/13

All 13 have identically named engine cases. Mounted persistence, isolation,
direction changes, sort deletion, and reactive row updates additionally run in
`list-view.spec.ts` and `list-view-state-parity.spec.ts`.

1. `create ascending sort in list view`
2. `create descending sort in list view`
3. `sort by number field in list view`
4. `sort by checkbox field in list view`
5. `sort by select option field in list view`
6. `delete sort in list view`
7. `change sort direction in list view`
8. `new row appears in list with active sort`
9. `edit row in grid updates list view with sort`
10. `create multiple sorts in list view`
11. `sort persists when switching views`
12. `sort is isolated per view`
13. `sort by date field in list view`

#### `database_list_filter_and_sort_test.dart` — 9/9

All nine have identically named engine cases. The mounted toolbar and
filtered-out-row-to-sorted-insertion paths additionally run in
`list-view.spec.ts` and `list-view-state-parity.spec.ts`.

1. `apply filter and sort in either order`
2. `delete filter or sort while the other remains active`
3. `change filter condition with active sort in list view`
4. `change sort direction with active filter in list view`
5. `new matching row appears with filter and sort active`
6. `new matching row is placed in correct sorted position with filter and sort`
7. `edit row to match filter shows it in list view`
8. `empty then non-empty filter results with sort in list view`
9. `cross-field filter/sort combinations in list view`

#### `database_list_grouping_test.dart` — 4/4

| Flutter case                                                                      | Executable Web destination                                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `list shows group headers and remove grouping option`                             | identically named generated Playwright BDD scenario in `list-group-visibility.feature` |
| `add row in group footer increases group count`                                   | identically named generated Playwright BDD scenario                                    |
| `remove grouping clears list headers and hides action`                            | identically named generated Playwright BDD scenario                                    |
| `board grouping does not carry over to list layout and remove grouping is hidden` | identically named generated Playwright BDD scenario                                    |

The same BDD feature also adds persistent real hide/show and hide-empty group
coverage beyond the four Flutter cases.

#### `database_list_load_more.dart` — 5/5 observable behaviors

| Flutter case                                              | Executable Web destination                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import list.afdb and verify grid shows rows`             | Web has no `.afdb` importer; the fixture's resulting 100-row state is created through the Web test bridge. This is the sole nonportable input mechanic. |
| `list view shows imported rows`                           | `List.test.tsx` and `list-view-live-flutter-parity.spec.ts` against equivalent 100-row data                                                             |
| `create new row in list view increases count`             | `List.test.tsx` and the live 100-to-101-row flow                                                                                                        |
| `scroll through list view loads all 100 rows`             | `List.test.tsx` threshold/batching assertions and the live scroll flow                                                                                  |
| `switching between grid and list shows rows consistently` | `list-view-live-flutter-parity.spec.ts` equal Grid/List counts                                                                                          |

#### `database_list_property_order_test.dart` — 1/1

| Flutter case                                                            | Executable Web destination                                                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `leading property respects visibility and renders before primary field` | `ListRow.test.tsx` plus live drag order, geometry, hide, view-switch, and reload persistence in `list-view-live-flutter-parity.spec.ts` |

#### `database_list_row_icon_test.dart` — 6/6

| Flutter case                                                          | Executable Web destination                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `row icon should be visible in list view after adding emoji`          | mounted emoji selection in `list-view.spec.ts`                    |
| `document indicator should appear in list view after adding content`  | mounted row-document flow in `list-view.spec.ts`                  |
| `emoji hides document indicator in list row (emoji takes priority)`   | combined document-then-emoji priority flow in `list-view.spec.ts` |
| `row icon should persist in list view after navigating away and back` | navigation/reload flows in both List Playwright suites            |
| `row icon should update in list view when changed in row detail`      | identically named `list-view.spec.ts` flow                        |
| `list view parity with grid view - both show emoji`                   | identically named `list-view.spec.ts` flow                        |

#### `database_list_row_operations.dart` — 5/5

| Flutter case                                      | Executable Web destination                                      |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `create row in list view`                         | `list-view.spec.ts`: List creation followed by equal Grid count |
| `click row opens row detail page`                 | mounted lifecycle flow in `list-view.spec.ts`                   |
| `delete row from list view updates both views`    | mounted lifecycle flow, then Grid count/title assertions        |
| `duplicate row from list view updates both views` | mounted lifecycle flow, then duplicate title/count assertions   |
| `edit cell in grid reflects in list view`         | identically named `list-view.spec.ts` flow                      |

This inventory leaves no uncovered portable case in the dedicated 70-case
matrix. The `.afdb` parser itself remains outside Web's supported product
surface; all behavior after import is covered.

Flutter's `list.afdb` fixture is not portable because Web has no raw `.afdb`
importer. The migrated load-more browser test deterministically creates the
same 100-row data through the Web test bridge and verifies all observable List
behaviors. It does not claim that Web can import the Flutter fixture format.

## Flutter BDD and cross-suite cases

| Flutter source                                                             | Web destination                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `desktop/bdd/database/list_group_visibility/list_group_visibility.feature` | `playwright/bdd/features/database/list-group-visibility.feature`; exact A/B/C hide/show behavior, plus persistent real empty-group coverage                                                                                                                              |
| List portions of `desktop/bdd/database/readonly/readonly.feature`          | `playwright/bdd/features/database/list-readonly.feature`; add-row/actions/editing disabled, row detail kept readonly, full-page navigation retained, and icon/cover/property/duplicate/delete mutations absent                                                           |
| `desktop/document/document_linked_list_test.dart`                          | `list-view.spec.ts` and `native-list-block-lifecycle.spec.ts`: create a linked List in a document, require raw Yjs `ty: "list"`, the exact source database/row IDs, render the real `database-list`, reload, duplicate/delete, and retain canonical `view_id`/`view_ids` |
| List portion of `desktop/database/database_view_display.dart`              | Live all-supported-field Properties/List flow plus compact `ListCell` renderer tests                                                                                                                                                                                     |
| List portion of `desktop/grid/grid_row_template_test.dart`                 | `row-template.spec.ts`; creates through List and requires the document indicator in the active List before checking Grid                                                                                                                                                 |

Flutter readonly tests use a test-only controller permission toggle. Web uses a
persisted locked document containing a linked List, which drives the mounted
ordinary App renderer's real readonly context. The fixture differs, but the
observable List and row-detail permission contracts are equivalent. Publish is
not used as a substitute.

## Creation and persistence

The current Cloud API rejects native standalone `ViewLayout.List` page
creation. Web therefore uses a transactional compatibility path:

1. create the database container through the supported Grid endpoint;
2. create a real List folder/database child;
3. normalize Desktop List field/layout settings and select its inline ID;
4. confirm that state through the sync outbox;
5. delete the exact temporary Grid folder and Yjs view and confirm cleanup.

Any post-create core failure compensates only the container created by that
operation. Embedded List creation similarly requires a live sync binding and
soft-deletes only its newly created child if conversion fails. The live test
hard-reloads and requires one child named `List`, a persisted List layout icon,
the same child ID, and no Grid tab. Navigation persistence is exercised by
leaving the database, reloading, and clicking its normal sidebar container;
that route must resolve the same sole List child without a direct URL shortcut.

## Known shared data-contract limitation

Web's shared rollup payload flattens original/unique list items to display
strings and does not retain related select-option IDs/colors. List renders
those raw items as Flutter-style neutral compact tags. Exact colored
select-rollup tags require a future shared rollup payload extension; the
Flutter field-display scenario does not assert that color-only branch.

## Validation scope

- List renderer/settings/creation/readonly Jest suites;
- exact 36-case filter/sort migration and generic List grouping dispatch/
  selector suites;
- generated and live List grouping/readonly Playwright BDD;
- live basic, row lifecycle, icon, linked/native-block serialization,
  duplicate/delete/reload, view-state, property-order, all-field, 100-row, and
  row-template Playwright flows;
- TypeScript, ESLint, Prettier, production build, and `git diff --check`.
