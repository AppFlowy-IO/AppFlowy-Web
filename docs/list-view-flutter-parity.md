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
| `database_list_sort_test.dart`               |    13 | Identically named engine cases plus live persistence/isolation and direction changes                                                                                                                                                                                                                         |

The 36 filter, sort, and filter-plus-sort cases are one-to-one input/result
migrations through the production filtering and sorting functions; the
persistence subset uses view-owned Yjs arrays. Representative Playwright flows
prove the mounted List toolbar, per-view persistence/isolation, direction and
deletion changes, and reactive row insertion after a row-detail edit. They are
not 36 duplicated browser-menu scenarios.

Flutter's `list.afdb` fixture is not portable because Web has no raw `.afdb`
importer. The migrated load-more browser test deterministically creates the
same 100-row data through the Web test bridge and verifies all observable List
behaviors. It does not claim that Web can import the Flutter fixture format.

## Flutter BDD and cross-suite cases

| Flutter source                                                             | Web destination                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop/bdd/database/list_group_visibility/list_group_visibility.feature` | `playwright/bdd/features/database/list-group-visibility.feature`; exact A/B/C hide/show behavior, plus persistent real empty-group coverage                                                          |
| List portions of `desktop/bdd/database/readonly/readonly.feature`          | `playwright/bdd/features/database/list-readonly.feature`; add-row/actions/editing disabled and row detail kept readonly with icon, cover, property, full-page, duplicate, and delete controls absent |
| `desktop/document/document_linked_list_test.dart`                          | Linked List source-row flow in `list-view.spec.ts`                                                                                                                                                   |
| List portion of `desktop/database/database_view_display.dart`              | Live all-supported-field Properties/List flow plus compact `ListCell` renderer tests                                                                                                                 |
| List portion of `desktop/grid/grid_row_template_test.dart`                 | `row-template.spec.ts`; creates through List and requires the document indicator in the active List before checking Grid                                                                             |

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
- live basic, row lifecycle, icon, linked, view-state, property-order,
  all-field, 100-row, and row-template Playwright flows;
- TypeScript, ESLint, Prettier, production build, and `git diff --check`.
