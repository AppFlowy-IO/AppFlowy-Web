# Database Gallery view Figma parity

Web follows the Figma gallery design. This document records how Web implements
it and where the desktop app still differs, so Desktop can be aligned later.

## Sources

- Figma: `Database` file `a3iCZh32MlkFqc178phnIM`, page `Gallery`
  (node `7404:109352`). Node IDs below refer to this file.
- Desktop: AppFlowy-Premium PR #1493 "revamp: database gallery" (merged
  2026-10-22). Desktop values were read from `main` after that merge, under
  `frontend/appflowy_flutter/lib/plugins/database/`.
- Web: `src/components/database/gallery/`, the gallery variant of
  `src/components/database/list/ListGroup.tsx`, and the gallery settings in
  `src/components/database/components/settings/`.

## Desktop differences to check

Web matches Figma in every row below. "Desktop" is what Desktop does today.

### Grid and card

| Area | Figma | Desktop | Desktop source |
| --- | --- | --- | --- |
| Card corner radius | 12px | 10px | `gallery/presentation/widgets/gallery_row_card.dart` (`BorderRadius.circular(10)`) |
| Gap between cards | 16px in both directions | 8px | `gallery/presentation/desktop_gallery_page.dart` (`_kGridGap = 8.0`, grouped and ungrouped) |
| Columns per size | Card widths stay in a range: Small 200-259px, Medium 260-360px, Large 361-480px. A 1492px content width shows 6 Small, 5 Medium or 4 Large cards (nodes `7435:214172`, `7435:215308`). | Fixed base widths 220, 300 and 400 with `floor(width / (cardWidth + gap))`, which gives 6, 4 and 3 cards at 1492px | `gallery/presentation/gallery_card_dimensions.dart`, `desktop_gallery_page.dart` |
| Cover height | 16:9 of the card width (183.75px on a 326.67px card) | Fixed 120, 150 and 180px | `gallery_card_dimensions.dart` |
| Card surface | `surface/layer-02` | `Theme.of(context).colorScheme.surface`; worth confirming it equals layer-02 in dark mode | `gallery_row_card.dart` |
| Card hover | Border becomes `border/primary-hover`, content area tints with `fill/content-hover`, card shadow unchanged (node `7422:203739`) | Border stays `border/primary`; adds `shadow.medium` (the content tint matches) | `gallery_row_card.dart` |
| Title | 14px weight 500, wraps onto more lines (node `7435:211243`) | Weight 600, `maxLines: 1` | `gallery_row_card.dart` (`_buildTitleRow`) |
| Gap from title to properties | 8px | 4px (`SizedBox(height: 4)`) | `gallery_row_card.dart` |
| Compact mode spacing | Inline properties 12px apart, rows 8px apart (node `7451:52975`) | `Wrap(spacing: 4, runSpacing: 8)` | `gallery_row_card.dart` (`_GalleryPropertiesRow`) |
| Person property | One person shows avatar and name; several people show avatars only (nodes `7451:51289`, `7451:52975`) | Always avatars only (`hideName: true`) | `widgets/cell/card_cell_style_maps/desktop_list_card_cell_style.dart` |

### Card actions

| Area | Figma | Desktop | Desktop source |
| --- | --- | --- | --- |
| Hover toolbar | Reposition, Rename, More (node `7438:222570`) | Adds a side-peek button first | `gallery_row_card.dart` (`_GalleryAccessoriesCluster`) |
| Toolbar tooltips | "Reposition" and "Rename" | "Reposition cover" (`document_plugins_cover_repositionCover`) and "Edit" (`button_edit`) | `gallery_row_card.dart` |
| Rename icon | `Icon / S / Rename`, a pencil over a baseline (node `7438:220314`) | `FlowySvgs.edit_s`, a pencil without the baseline | `gallery_row_card.dart` |
| More menu | 240px: Copy link, Duplicate, Delete (node `7438:223081`) | 200px: Duplicate, Delete | `gallery/presentation/widgets/gallery_row_card_menu.dart` |
| "Drag image to reposition" hint | Black 40% pill with fully opaque white text (node `7438:222959`) | A black 60% container inside `Opacity(0.4)`, which also fades the text | `gallery_row_card.dart` |
| Reposition Cancel and Save | Both 64px wide; Save has 8px side padding (node `7438:222962`) | Width follows the label; 6px side padding | `gallery_row_card.dart` (`_CoverStyleTextButton`, `_CoverStyleSaveButton`) |

### New page and groups

| Area | Figma | Desktop | Desktop source |
| --- | --- | --- | --- |
| "New page" tile | Transparent with a `border/primary` outline and 12px radius; hover tints it (nodes `7422:204489`, `7435:207144`) | Filled with `colorScheme.surface`, 10px radius; hover adds `shadow.medium` | `gallery/presentation/widgets/gallery_new_row_card.dart` |
| "New page" inside a group | Takes the free slot in the group's last row; the one-column footer appears only when that row is full (nodes `7435:211112`, `7435:211106`) | Always the footer below the group | `desktop_gallery_page.dart` (`showNewRowAffordance: false`, `GalleryGroupFooter`) |
| Footer plus icon | `icon/tertiary` (#B5BBD3) | Same color as the label, `text/secondary` | `gallery/presentation/widgets/gallery_group_footer.dart` |
| Group header spacing | 4px between the collapse toggle and the tag (node `7435:211111`) | 8px (`HSpace(spacing.m)`) | `widgets/group/group_header.dart` |
| Group menu | Hide group, Delete (node `7435:211320`) | Hide, Remove grouping | `widgets/group/group_header.dart` (`GroupMoreButton`) |
| Delete group | Confirmation "Delete group / All pages inside this group will be deleted." (node `7435:211323`) | Not offered in Gallery | none |
| New group | "+ New group" button after the last group (node `7448:47359`) | Not offered in Gallery | none |

### Settings menu

| Area | Figma | Desktop | Desktop source |
| --- | --- | --- | --- |
| Properties entry | "Property visibility" with the eye icon (node `7422:132322`) | "Properties" (`grid_settings_properties`) with the eye icon | `widgets/setting/database_setting_action.dart` |
| Layout entry icon | Shows the current layout's icon (annotation on node `7422:132322`) | Always `FlowySvgs.layout_s` | `widgets/setting/database_setting_action.dart` |

## Web behavior that Desktop does not read

- **New group keeps the new group visible.** Web stores the new option in
  `shown_empty_group_ids` of the Gallery layout setting (slot `5`) so "Hide
  empty groups" does not hide it while it is empty. Desktop reads that key only
  for Board, so a group created on Web stays hidden on Desktop until it has a
  page. Turning "Hide empty groups" off clears the list, as on Board.
- **Delete group** uses the same contract as the Board column delete and
  Desktop `delete_group`: it deletes every page in the group and, for select
  fields, the option. It is not offered for the default group or for Created
  by and Last edited by groupings, which Desktop also refuses.
- **Copy link** copies the row page URL that the row dialog opens in a new tab
  (`/app/<workspace>/<database page>?v=<view>&r=<row>`). It is hidden on
  published pages.

## Decisions where Figma is silent

These follow Desktop and are not listed as differences:

- Clicking a card opens the row, the action Desktop also offers as its Peek
  button. Figma's toolbar holds only editing actions, so read-only cards show
  no toolbar.
- The ungrouped "New page" tile creates a row without opening it. Group
  headers, group footers and in-group tiles open the new row.
- Grouped cards cannot be reordered by drag.
- "No groups for {field}" is shown when a grouping leaves nothing visible.
  It comes from Desktop; Figma has no empty state.

## Other inconsistencies noticed

- Desktop's Gallery bloc reads a missing `hide_empty_groups` as `false`
  (`gallery/application/gallery_bloc.dart`), while its backend treats a
  missing flag as `true` for Gallery. Web treats it as `true`.
- The shared Layout menu on Web lists Timeline, and lists Chart only on
  self-hosted servers. The Figma list is Grid, Board, Calendar, List, Gallery,
  Chart, Feed. This menu is shared by every layout, so Web was not changed.
