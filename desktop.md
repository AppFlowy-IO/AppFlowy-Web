# AppFlowy Document Table (SimpleTable) - Complete UI Component Analysis

## Table of Contents

**Part I: AppFlowy SimpleTable Flutter Implementation**

1. [Architecture Overview](#1-architecture-overview)
2. [Node/Data Model](#2-nodedata-model)
3. [Widget Hierarchy & Layout](#3-widget-hierarchy--layout)
4. [Styling & Theming](#4-styling--theming)
5. [Border System](#5-border-system)
6. [Icons Reference](#6-icons-reference)
7. [All Actions Catalog](#7-all-actions-catalog)
8. [New Row / New Column Actions (Deep Dive)](#8-new-row--new-column-actions-deep-dive)
9. [Keyboard Shortcuts](#9-keyboard-shortcuts)
10. [State Management (SimpleTableContext)](#10-state-management-simpletablecontext)
11. [File Index](#11-file-index)

**Part II: Open-Source React Document Table Research**

12. [Research Overview](#12-research-overview)
13. [Plate (Slate.js)](#13-plate-slatejs----closest-match)
14. [TipTap (ProseMirror)](#14-tiptap-prosemirror----most-mature-table-engine)
15. [Lexical (Meta)](#15-lexical-meta----metas-editor-framework)
16. [BlockNote (ProseMirror/TipTap)](#16-blocknote-prosemirrortiptap----best-notion-like-ux)
17. [AFFiNE / BlockSuite](#17-affine--blocksuite----most-ambitious-not-react)
18. [Other Notable Projects](#18-other-notable-projects)
19. [Feature Comparison Matrix](#19-feature-comparison-matrix)
20. [Key Takeaways & Recommendations](#20-key-takeaways--recommendations)

---

## 1. Architecture Overview

The document table is called **SimpleTable** internally. It is a block-level editor plugin registered in AppFlowy's `appflowy_editor` system. The table is composed of three nested block types:

```
SimpleTableBlockWidget  (type: "simple_table")
  └── SimpleTableRowBlockWidget  (type: "simple_table_row")  ×N rows
        └── SimpleTableCellBlockWidget  (type: "simple_table_cell")  ×M columns
              └── [Any block content: paragraph, heading, image, code, etc.]
```

Key architectural points:
- The table is **NOT** the database grid. It lives purely inside the document editor.
- Operations are implemented as **Dart extension methods on `EditorState`**, using the editor's transaction system for undo/redo support.
- Desktop and mobile have **separate rendering paths** but share the same data model and operations.
- State is managed via `SimpleTableContext`, a collection of `ValueNotifier`s provided through Flutter's `Provider`.

---

## 2. Node/Data Model

**Source:** `simple_table_block_component.dart`

### Block Keys & Attributes

```dart
class SimpleTableBlockKeys {
  static const String type = 'simple_table';
  
  // Header toggles (bool, default false)
  static const String enableHeaderRow = 'enable_header_row';
  static const String enableHeaderColumn = 'enable_header_column';
  
  // Color maps: {index_string: color_hex_or_theme_name, ...}
  static const String columnColors = 'column_colors';
  static const String rowColors = 'row_colors';
  
  // Alignment maps: {index_string: 'left'|'center'|'right', ...}
  static const String columnAligns = 'column_aligns';
  static const String rowAligns = 'row_aligns';
  
  // Bold attribute maps: {index_string: true|false, ...}
  static const String columnBoldAttributes = 'column_bold_attributes';
  static const String rowBoldAttributes = 'row_bold_attributes';
  
  // Text color maps: {index_string: color_hex, ...}
  static const String columnTextColors = 'column_text_colors';
  static const String rowTextColors = 'row_text_colors';
  
  // Column width map: {index_string: width_double, ...}
  static const String columnWidths = 'column_widths';
  
  // Whether columns are distributed evenly (bool, default false)
  static const String distributeColumnWidthsEvenly = 'distribute_column_widths_evenly';
}
```

### Factory Functions

| Function | Description |
|----------|-------------|
| `simpleTableBlockNode(...)` | Creates a table node with attributes and row children |
| `simpleTableRowBlockNode(children)` | Creates a row node containing cell children |
| `simpleTableCellBlockNode(children)` | Creates a cell node; defaults to a single `paragraphNode()` |
| `createSimpleTableBlockNode(columnCount, rowCount)` | Convenience: creates a full table with given dimensions |

### Default Table Creation (via Slash Menu)

The `/table` slash command creates a **2x2 table** and places the cursor in the first cell:

```dart
// simple_table_item.dart
final table = createSimpleTableBlockNode(columnCount: 2, rowCount: 2);
```

---

## 3. Widget Hierarchy & Layout

### Desktop Layout

**Source:** `_desktop_simple_table_widget.dart`

```
SimpleTableBlockWidget
  ├── Transform.translate(offset: -tableLeftPadding)  // shift left 8px
  │   └── Align(topLeft)
  │       └── Provider(SimpleTableContext)
  │           └── MouseRegion(table block hover)
  │               └── DesktopSimpleTableWidget
  │                   └── MouseRegion(table area hover)
  │                       └── Stack
  │                           ├── MouseRegion(columns+rows hover tracking)
  │                           │   └── Scrollbar + SingleChildScrollView(horizontal)
  │                           │       └── Padding(tablePadding)
  │                           │           └── IntrinsicWidth
  │                           │               └── IntrinsicHeight
  │                           │                   └── Column(rows)
  │                           │                       ├── Row(cells) per row
  │                           │                       └── ...
  │                           ├── SimpleTableAddColumnHoverButton  (Positioned right)
  │                           ├── SimpleTableAddRowHoverButton     (Positioned bottom)
  │                           └── SimpleTableAddColumnAndRowHoverButton (Positioned bottom-right corner)
  └── BlockComponentActionWrapper (if showActions)
```

### Row Layout

**Source:** `simple_table_row_block_component.dart`

```dart
IntrinsicHeight(
  child: Row(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [cell1, cell2, cell3, ...],  // each cell rendered by editorState.renderer
  ),
)
```

- If `alwaysDistributeColumnWidths` is true, cells are wrapped in `Flexible`.
- If `borderType == table`, `SimpleTableRowDivider` is inserted between cells.

### Cell Layout

**Source:** `simple_table_cell_block_component.dart`

Each cell is a `Stack` containing:

```
Stack(clipBehavior: Clip.none)
  ├── _buildCell()  →  DecoratedBox(border + bg) → Container(padding + width) → Column(children)
  ├── [if columnIndex == 0] Positioned(left): Row more-action menu
  ├── [if rowIndex == 0]    Positioned(top): Column more-action menu
  ├── [if (0,0)]            Positioned(top-left): Table action menu (mobile only)
  └── Positioned(right):    Column resize handle
```

Desktop cells are wrapped in `MouseRegion` for hover tracking. Mobile cells have additional resize handles on both sides.

**Cell Content Width:**
- Fixed width from `node.columnWidth` (default `160.0` dp)
- If `alwaysDistributeColumnWidths`, width is `null` (flexible)
- Minimum constraint: `36.0` dp

---

## 4. Styling & Theming

### Size Constants

**Source:** `simple_table_constants.dart` → `SimpleTableConstants`

| Constant | Value | Description |
|----------|-------|-------------|
| `defaultColumnWidth` | `160.0` dp | Default width of each column |
| `minimumColumnWidth` | `36.0` dp | Minimum allowed column width |
| `defaultRowHeight` | `36.0` dp | Default row height |
| `cellBorderWidth` | `1.0` dp | Cell border line width |
| `resizeHandleWidth` | `3.0` dp | Width of the resize drag handle |
| `addRowButtonHeight` | `16.0` dp | Height of the "add row" button |
| `addRowButtonPadding` | `4.0` dp | Padding around the add-row button |
| `addRowButtonRadius` | `4.0` dp | Corner radius of the add-row button |
| `addColumnButtonWidth` | `16.0` dp | Width of the "add column" button |
| `addColumnButtonPadding` | `2.0` dp | Padding around the add-column button |
| `addColumnButtonRadius` | `4.0` dp | Corner radius of the add-column button |
| `addColumnAndRowButtonWidth` | `16.0` dp | Corner button size (same as column button) |
| `addColumnAndRowButtonCornerRadius` | `8.0` dp | 50% radius (circular) |
| `moreActionHeight` | `34.0` dp | Height of each action menu item |
| `tableHitTestTopPadding` | `8.0` (desktop) / `24.0` (mobile) | Padding for hit testing |
| `tableHitTestLeftPadding` | `0.0` (desktop) / `24.0` (mobile) | Padding for hit testing |
| `tableLeftPadding` | `8.0` (desktop) / `0.0` (mobile) | Left padding of table |

### Cell Padding

```dart
static EdgeInsets get cellEdgePadding => const EdgeInsets.symmetric(
  horizontal: 9.0,
  vertical: 4.0,
);
```

### Table Padding (space for action buttons)

```dart
static EdgeInsets get tablePadding => EdgeInsets.only(
  bottom: addRowButtonHeight + 3 * addRowButtonPadding,  // = 28.0
  left: tableLeftPadding,                                 // = 8.0 desktop
  right: addColumnButtonWidth + 2 * addColumnButtonPadding, // = 20.0
);
```

### Color System

**Source:** `simple_table_constants.dart` → `SimpleTableColors` extension on `BuildContext`

| Color | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `simpleTableBorderColor` | `#E4E5E5` | `#3A3F49` | Default cell borders |
| `simpleTableDividerColor` | `#141F2329` (8% opacity) | `#23262B` (50% opacity) | Table divider lines |
| `simpleTableMoreActionBackgroundColor` | `#F2F3F5` | `#2D3036` | Action button background |
| `simpleTableMoreActionBorderColor` | `#CFD3D9` | `#44484E` | Action button border |
| `simpleTableMoreActionHoverColor` | `#00C8FF` | `#00C8FF` | Hover accent (cyan) |
| `simpleTableDefaultHeaderColor` | `#F2F2F2` | `#08FFFFFF` (3% white) | Header row/column background |
| `simpleTableActionButtonBackgroundColor` | `#FFFFFF` | `#2D3036` | Generic action button bg |
| `simpleTableInsertActionBackgroundColor` | `#F2F2F7` | `#2D3036` | Insert action button bg |
| `simpleTableQuickActionBackgroundColor` | `null` | `#BBC3CD` | Mobile quick action bg |

### Cell Background Color Priority

Resolved in `_buildBackgroundColor()` in this order (first match wins):

1. **Selecting table** → `Theme.colorScheme.primary` at 10% opacity
2. **Column color** → from `columnColors` attribute map
3. **Row color** → from `rowColors` attribute map
4. **Header color** → `simpleTableDefaultHeaderColor` (if cell is in a header row/column)
5. **Default** → `Colors.transparent`

### Cell Content Alignment

Priority: Column alignment > Row alignment > Default (`Alignment.topLeft`)

Supported values: `left`, `center`, `right` (maps to `Alignment.topLeft`, `Alignment.topCenter`, `Alignment.topRight`)

### More Action Menu Item Text Style

```dart
FlowyText.regular(
  action.name,
  fontSize: 14.0,
  figmaLineHeight: 18.0,
)
```

---

## 5. Border System

**Source:** `simple_table_border_builder.dart`

The default border render type is `SimpleTableBorderRenderType.cell` (each cell draws its own border).

### Border States & Styles

| State | Border Style | Width | Color |
|-------|-------------|-------|-------|
| **Default (outer edges)** | Solid | `1.0` | `simpleTableBorderColor` |
| **Default (inner edges)** | Solid | `0.5` | `simpleTableBorderColor` |
| **Highlight (selection)** | Solid | `2.0` | `Theme.colorScheme.primary` |
| **Editing cell** | Solid (all sides) | `2.0` | `Theme.colorScheme.primary` |
| **Selecting table** | Highlight on outer, light on inner | `2.0` / `0.5` | primary / border color |
| **Column selected** | Highlight on left+right, light/highlight on top+bottom | `2.0` / `0.5` | primary / border color |
| **Row selected** | Highlight on top+bottom, light/highlight on left+right | `2.0` / `0.5` | primary / border color |
| **Reordering** | Highlight on insert-side edge only | `2.0` | `Theme.colorScheme.primary` |

### Border Resolution Logic

```
if (!editable)             → buildCellBorder()
else if (isReordering)     → buildReorderingBorder()
else if (isSelectingTable) → buildSelectingTableBorder()
else if (columnSelected)   → buildColumnHighlightBorder()
else if (rowSelected)      → buildRowHighlightBorder()
else if (isEditingCell)    → buildEditingBorder()
else                       → buildCellBorder()
```

---

## 6. Icons Reference

**Source:** `simple_table_more_action.dart` → `SimpleTableMoreAction.leftIconSvg`

| Action | Icon (FlowySvgs) | Platform |
|--------|------------------|----------|
| Add row/column/both | `FlowySvgs.add_s` | Both |
| Insert Left | `FlowySvgs.table_insert_left_s` | Desktop |
| Insert Right | `FlowySvgs.table_insert_right_s` | Desktop |
| Insert Above | `FlowySvgs.table_insert_above_s` | Desktop |
| Insert Below | `FlowySvgs.table_insert_below_s` | Desktop |
| Duplicate | `FlowySvgs.duplicate_s` | Desktop |
| Duplicate (Row/Column/Table) | `FlowySvgs.m_table_duplicate_s` | Mobile |
| Delete | `FlowySvgs.trash_s` | Both |
| Clear Contents | `FlowySvgs.table_clear_content_s` | Both |
| Set to Page Width | `FlowySvgs.table_set_to_page_width_s` | Both |
| Distribute Columns Evenly | `FlowySvgs.table_distribute_columns_evenly_s` | Both |
| Enable Header Column | `FlowySvgs.table_header_column_s` | Both |
| Enable Header Row | `FlowySvgs.table_header_row_s` | Both |
| Reorder Column | `FlowySvgs.table_reorder_column_s` | Both |
| Reorder Row | `FlowySvgs.table_reorder_row_s` | Both |
| Align Left | `FlowySvgs.table_align_left_s` / `FlowySvgs.m_aa_align_left_s` | Desktop / Mobile |
| Align Center | `FlowySvgs.table_align_center_s` | Both |
| Align Right | `FlowySvgs.table_align_right_s` | Both |
| Cut | `FlowySvgs.m_table_quick_action_cut_s` | Mobile |
| Copy | `FlowySvgs.m_table_quick_action_copy_s` | Mobile |
| Paste | `FlowySvgs.m_table_quick_action_paste_s` | Mobile |
| Bold | `FlowySvgs.m_aa_bold_s` | Mobile |
| Text Color | `FlowySvgs.m_table_text_color_m` | Mobile |
| Copy Link to Block | `FlowySvgs.m_copy_link_s` | Mobile |
| Table Action Menu (mobile) | `FlowySvgs.drag_element_s` | Mobile |

---

## 7. All Actions Catalog

### SimpleTableMoreAction Enum (21 values + 4 UI helpers)

**Source:** `simple_table_more_action.dart`

```dart
enum SimpleTableMoreAction {
  // Shared desktop + mobile
  insertLeft, insertRight, insertAbove, insertBelow,
  duplicate, clearContents, delete,
  align, backgroundColor,
  enableHeaderColumn, enableHeaderRow,
  setToPageWidth, distributeColumnsEvenly,
  divider,  // UI separator, not an action

  // Mobile-only
  duplicateRow, duplicateColumn, duplicateTable,
  cut, copy, paste,
  bold,
  textColor, textBackgroundColor,
  copyLinkToBlock,
}
```

### Desktop Context Menu Actions

Built by `SimpleTableMoreActionType.buildDesktopActions()`:

**For Rows:**
```
insertAbove → insertBelow → [divider]
→ [enableHeaderRow (only if index==0)]
→ backgroundColor → align → [divider]
→ setToPageWidth → distributeColumnsEvenly → [divider]
→ duplicate → clearContents → [delete (if rowLength > 1)]
```

**For Columns:**
```
insertLeft → insertRight → [divider]
→ [enableHeaderColumn (only if index==0)]
→ backgroundColor → align → [divider]
→ setToPageWidth → distributeColumnsEvenly → [divider]
→ duplicate → clearContents → [delete (if columnLength > 1)]
```

### Mobile Bottom Sheet Actions

Built by `SimpleTableMoreActionType.buildMobileActions()`:

**For Rows:** (grouped sections)
```
Section 1: [enableHeaderRow] (only if index==0)
Section 2: [setToPageWidth, distributeColumnsEvenly]
Section 3: [duplicateRow, clearContents]
```

**For Columns:** (grouped sections)
```
Section 1: [enableHeaderColumn] (only if index==0)
Section 2: [setToPageWidth, distributeColumnsEvenly]
Section 3: [duplicateColumn, clearContents]
```

Additional mobile quick actions: `cut`, `copy`, `paste`, `delete`

### Operations Implementations

All operations are **extension methods on `EditorState`**:

#### Insert Operations (`simple_table_insert_operation.dart`)

| Method | Description |
|--------|-------------|
| `addRowInTable(tableNode)` | Appends a row at the end |
| `addColumnInTable(node)` | Appends a column at the end |
| `addColumnAndRowInTable(node)` | Appends both a column and a row |
| `insertColumnInTable(node, index)` | Inserts column at specific index |
| `insertRowInTable(node, index)` | Inserts row at specific index |

#### Delete Operations (`simple_table_delete_operation.dart`)

| Method | Description |
|--------|-------------|
| `deleteRowInTable(tableNode, rowIndex)` | Deletes a row by index |
| `deleteColumnInTable(tableNode, columnIndex)` | Deletes a column by index |

#### Duplicate Operations (`simple_table_duplicate_operation.dart`)

| Method | Description |
|--------|-------------|
| `duplicateRowInTable(node, index)` | Duplicates row at index (inserts copy below) |
| `duplicateColumnInTable(node, index)` | Duplicates column at index (inserts copy to right) |
| `duplicateTable(tableNode)` | Duplicates entire table (inserts copy after original) |

#### Reorder Operations (`simple_table_reorder_operation.dart`)

| Method | Description |
|--------|-------------|
| `reorderColumn(node, fromIndex, toIndex)` | Moves column from one position to another |
| `reorderRow(node, fromIndex, toIndex)` | Moves row from one position to another |

#### Style Operations (`simple_table_style_operation.dart`)

| Method | Description |
|--------|-------------|
| `updateColumnWidthInMemory(tableCellNode, deltaX)` | Live width update during drag (in-memory only) |
| `updateColumnWidth(tableCellNode, width)` | Persist column width after drag ends |
| `updateColumnAlign(tableCellNode, align)` | Set column text alignment |
| `updateRowAlign(tableCellNode, align)` | Set row text alignment |
| `updateTableAlign(tableNode, align)` | Set all columns to same alignment |
| `updateColumnBackgroundColor(tableCellNode, color)` | Set column background color |
| `updateRowBackgroundColor(tableCellNode, color)` | Set row background color |
| `setColumnWidthToPageWidth(tableNode)` | Scale all columns proportionally to fill page width |
| `distributeColumnWidthToPageWidth(tableNode)` | Make all columns equal width (desktop only) |
| `toggleColumnBoldAttribute(tableCellNode, isBold)` | Toggle bold for all cells in a column |
| `toggleRowBoldAttribute(tableCellNode, isBold)` | Toggle bold for all cells in a row |
| `updateColumnTextColor(tableCellNode, color)` | Set text color for all cells in a column |
| `updateRowTextColor(tableCellNode, color)` | Set text color for all cells in a row |
| `clearColumnTextAlign(tableCellNode)` | Clear alignment overrides for a column |
| `clearRowTextAlign(tableCellNode)` | Clear alignment overrides for a row |

#### Header Operations (`simple_table_header_operation.dart`)

| Method | Description |
|--------|-------------|
| `toggleEnableHeaderColumn(tableNode, enable)` | Toggle first column as header (clears column 0 bg color when enabled) |
| `toggleEnableHeaderRow(tableNode, enable)` | Toggle first row as header (clears row 0 bg color when enabled) |

#### Content Operations (`simple_table_content_operation.dart`)

| Method | Description |
|--------|-------------|
| `clearContentAtRowIndex(tableNode, rowIndex)` | Replace all cells in a row with empty cells |
| `clearContentAtColumnIndex(tableNode, columnIndex)` | Replace all cells in a column with empty cells |
| `clearAllContent(tableNode)` | Clear all cells in the entire table |
| `copyColumn(tableNode, columnIndex, clearContent?)` | Copy column to clipboard (optional cut) |
| `copyRow(tableNode, rowIndex, clearContent?)` | Copy row to clipboard (optional cut) |
| `copyTable(tableNode, clearContent?)` | Copy entire table to clipboard |
| `pasteColumn(tableNode, columnIndex)` | Paste clipboard content into column |
| `pasteRow(tableNode, rowIndex)` | Paste clipboard content into row |
| `pasteTable(tableNode)` | Paste clipboard content into table |

---

## 8. New Row / New Column Actions (Deep Dive)

### 8.1 Add Row Button

**Source:** `simple_table_add_row_button.dart`

**Widget:** `SimpleTableAddRowHoverButton` → wraps `SimpleTableAddRowButton`

**Visibility Logic:**
- Shows when hovering on the table area AND the mouse is over the **last row** (`enableHoveringLogicV2`)
- Also shows when actively dragging to expand rows (`isDraggingRow`)

**Positioning:**
```dart
Positioned(
  bottom: 2 * addRowButtonPadding,  // = 8.0 dp from bottom
  left: tableLeftPadding - cellBorderWidth,  // = 7.0 dp
  right: addRowButtonRightPadding,  // = 20.0 dp (space for column button)
)
```

**Appearance:**
- Height: `16.0` dp
- Margin: `2.0` dp vertical
- Background: `simpleTableMoreActionBackgroundColor` (`#F2F3F5` light / `#2D3036` dark)
- Border radius: `4.0` dp
- Icon: `FlowySvgs.add_s` (plus icon, centered)
- Cursor: `SystemMouseCursors.click`
- Tooltip: `LocaleKeys.document_plugins_simpleTable_clickToAddNewRow`

**Actions:**
1. **Tap** → calls `editorState.addRowInTable(tableNode)` which appends a new row at the end
2. **Vertical drag** → experimental drag-to-expand feature (currently disabled: `enableDragToExpandTable = false`)
   - Tracks `startDraggingOffset` and calculates row delta based on drag distance / `defaultRowHeight`
   - Dynamically inserts or deletes rows via `insertRowInTable` / `deleteRowInTable` with `inMemoryUpdate: true`

### 8.2 Add Column Button

**Source:** `simple_table_add_column_button.dart`

**Widget:** `SimpleTableAddColumnHoverButton` → wraps `SimpleTableAddColumnButton`

**Visibility Logic:**
- Shows when hovering on the table area AND the mouse is over the **last column**
- Uses `Opacity(0.0)` to hide (still occupies space) vs `SizedBox.shrink` for the row button

**Positioning:**
```dart
Positioned(
  top: tableHitTestTopPadding - cellBorderWidth,  // = 7.0 dp
  bottom: addColumnButtonBottomPadding,  // = 28.0 dp
  right: 0,
)
```

**Appearance:**
- Width: `16.0` dp
- Margin: `2.0` dp horizontal
- Background: `simpleTableMoreActionBackgroundColor`
- Border radius: `4.0` dp
- Icon: `FlowySvgs.add_s`
- Cursor: `SystemMouseCursors.click`
- Tooltip: `LocaleKeys.document_plugins_simpleTable_clickToAddNewColumn`

**Actions:**
1. **Tap** → calls `editorState.addColumnInTable(tableNode)` which appends a new column at the end
2. **Horizontal drag** → experimental drag-to-expand feature (disabled)

### 8.3 Add Column AND Row Button (Corner Button)

**Source:** `simple_table_add_column_and_row_button.dart`

**Widget:** `SimpleTableAddColumnAndRowHoverButton` → wraps `SimpleTableAddColumnAndRowButton`

**Visibility Logic:**
- Shows when hovering on the **last cell** of the table (`isLastCellInTable`)

**Positioning:**
```dart
Positioned(
  bottom: addColumnAndRowButtonBottomPadding,  // = 10.0 dp
  right: addColumnButtonPadding,               // = 2.0 dp
)
```

**Appearance:**
- Width: `16.0` dp, Height: `16.0` dp (square)
- Background: `simpleTableMoreActionBackgroundColor`
- Border radius: `8.0` dp (fully circular)
- Icon: `FlowySvgs.add_s`
- Cursor: `SystemMouseCursors.click`
- Tooltip: `LocaleKeys.document_plugins_simpleTable_clickToAddNewRowAndColumn`

**Action:**
- **Tap** → calls `editorState.addColumnAndRowInTable(node)` which sequentially calls `addColumnInTable` then `addRowInTable`

### 8.4 Context Menu Insert Actions

From `simple_table_more_action_popup.dart`:

| Action | Calls | Cursor Placement |
|--------|-------|-----------------|
| Insert Left | `insertColumnInTable(table, columnIndex)` | First row of new column |
| Insert Right | `insertColumnInTable(table, columnIndex + 1)` | First row of new column |
| Insert Above | `insertRowInTable(table, rowIndex)` | First column of new row |
| Insert Below | `insertRowInTable(table, rowIndex + 1)` | First column of new row |

All four actions:
1. Clear the current selection first
2. Call the insert operation
3. Get the newly created cell node
4. Set `editorState.selection` to a collapsed position at the new cell's first child

### 8.5 Insert Operation Internals

**`insertColumnInTable(node, index)`:**
1. Compute `mapTableAttributes` to remap attribute indices (colors, aligns, widths, bold, text colors)
2. Create a transaction
3. For each row: insert a `simpleTableCellBlockNode()` at the target column index
4. Update table node attributes with remapped values
5. Apply transaction (supports `inMemoryUpdate` flag for drag operations)

**`insertRowInTable(node, index)`:**
1. Compute `mapTableAttributes` to remap row attribute indices
2. Create a new `simpleTableRowBlockNode` with N empty cells (matching column count)
3. Insert the row at the target path
4. Update table node attributes with remapped values
5. Apply transaction

---

## 9. Keyboard Shortcuts

**Source:** `simple_table_shortcuts/simple_table_commands.dart` and individual command files

| Shortcut | File | Behavior |
|----------|------|----------|
| Arrow Up | `simple_table_arrow_up_command.dart` | Navigate to cell above |
| Arrow Down | `simple_table_arrow_down_command.dart` | Navigate to cell below |
| Arrow Left | `simple_table_arrow_left_command.dart` | Navigate to previous cell in row |
| Arrow Right | `simple_table_arrow_right_command.dart` | Navigate to next cell in row |
| Tab | `simple_table_tab_command.dart` | Move to next cell (left-to-right, top-to-bottom) |
| Shift+Tab | `simple_table_tab_command.dart` | Move to previous cell |
| Enter | `simple_table_enter_command.dart` | Insert new line or navigate |
| Backspace | `simple_table_backspace_command.dart` | Delete content within cell |
| Ctrl/Cmd+A | `simple_table_select_all_command.dart` | Select all content in current cell |

Helper extensions in `simple_table_command_extension.dart`:
- `isCurrentSelectionInTableCell()` - checks if cursor is inside a table cell
- `moveToPreviousCell()` - Shift+Tab navigation logic
- `moveToNextCell()` - Tab navigation logic

---

## 10. State Management (SimpleTableContext)

**Source:** `simple_table_constants.dart`

`SimpleTableContext` is provided via Flutter's `Provider` and contains these `ValueNotifier`s:

| Notifier | Type | Purpose |
|----------|------|---------|
| `isHoveringOnColumnsAndRows` | `ValueNotifier<bool>` | Whether mouse is over the cell grid area |
| `isHoveringOnTableArea` | `ValueNotifier<bool>` | Whether mouse is over the table area (excludes add buttons) |
| `isHoveringOnTableBlock` | `ValueNotifier<bool>` | Whether mouse is over the entire table block (includes padding) |
| `hoveringTableCell` | `ValueNotifier<Node?>` | The specific cell node under the mouse |
| `hoveringOnResizeHandle` | `ValueNotifier<Node?>` | The cell whose resize handle is being hovered |
| `selectingColumn` | `ValueNotifier<int?>` | Index of the selected column (via context menu) |
| `selectingRow` | `ValueNotifier<int?>` | Index of the selected row (via context menu) |
| `isSelectingTable` | `ValueNotifier<bool>` | Whether the entire table is selected |
| `isReorderingColumn` | `ValueNotifier<(bool, int)>` | (isReordering, columnIndex) tuple |
| `isReorderingRow` | `ValueNotifier<(bool, int)>` | (isReordering, rowIndex) tuple |
| `reorderingOffset` | `ValueNotifier<Offset>` | Current drag position during reorder |
| `isEditingCell` | `ValueNotifier<Node?>` | Cell currently being edited (mobile only) |
| `isReorderingHitIndex` | `ValueNotifier<int?>` | Column/row being targeted during reorder (mobile) |
| `resizingCell` | `ValueNotifier<Node?>` | Cell currently being resized (mobile) |

Non-notifier fields:
- `isDraggingRow` / `isDraggingColumn` (bool) — drag-to-expand state
- `horizontalScrollController` (ScrollController?) — table scroll controller
- `isReordering` (computed getter) — true if any reordering is active

---

## 11. File Index

### Core Components

| File | Description |
|------|-------------|
| `simple_table.dart` | Barrel export file |
| `simple_table_block_component.dart` | Table block widget, node keys, factory functions |
| `simple_table_row_block_component.dart` | Row block widget (IntrinsicHeight + Row layout) |
| `simple_table_cell_block_component.dart` | Cell block widget (Stack with content + action overlays) |
| `simple_table_constants.dart` | `SimpleTableContext`, `SimpleTableConstants`, color extensions |

### Operations (extensions on EditorState)

| File | Operations |
|------|------------|
| `simple_table_insert_operation.dart` | addRow, addColumn, addColumnAndRow, insertColumn, insertRow |
| `simple_table_delete_operation.dart` | deleteRow, deleteColumn |
| `simple_table_duplicate_operation.dart` | duplicateRow, duplicateColumn, duplicateTable |
| `simple_table_reorder_operation.dart` | reorderColumn, reorderRow |
| `simple_table_style_operation.dart` | updateColumnWidth, updateAlign, updateBackgroundColor, toggleBold, textColor, setToPageWidth, distributeEvenly, clearTextAlign |
| `simple_table_header_operation.dart` | toggleEnableHeaderColumn, toggleEnableHeaderRow |
| `simple_table_content_operation.dart` | clearContent, copyRow/Column/Table, pasteRow/Column/Table |
| `simple_table_map_operation.dart` | Attribute index remapping for insert/delete/duplicate/reorder |
| `simple_table_node_extension.dart` | Node helper extensions (parentTableNode, columnIndex, rowIndex, etc.) |

### UI Widgets

| File | Description |
|------|-------------|
| `simple_table_widget.dart` | Platform switch: desktop vs mobile |
| `_desktop_simple_table_widget.dart` | Desktop layout (Scrollbar, Stack, hover buttons) |
| `_mobile_simple_table_widget.dart` | Mobile layout (SingleChildScrollView) |
| `simple_table_add_row_button.dart` | Add row hover button + drag support |
| `simple_table_add_column_button.dart` | Add column hover button + drag support |
| `simple_table_add_column_and_row_button.dart` | Corner add-both button |
| `simple_table_border_builder.dart` | Cell border rendering for all states |
| `simple_table_divider.dart` | Row/column divider widgets (table border type) |
| `simple_table_column_resize_handle.dart` | Column resize drag handle |
| `simple_table_reorder_button.dart` | Draggable reorder button (column/row grip) |
| `simple_table_more_action_popup.dart` | Desktop popover context menu for row/column actions |
| `simple_table_background_menu.dart` | Color picker sub-menu for background colors |
| `simple_table_align_button.dart` | Alignment picker sub-menu |
| `simple_table_basic_button.dart` | Reusable button component for menu items |
| `simple_table_feedback.dart` | Drag feedback visualization |
| `simple_table_action_sheet.dart` | Mobile action sheet container |
| `simple_table_bottom_sheet.dart` | Mobile bottom sheet for table actions |
| `_simple_table_bottom_sheet_actions.dart` | Mobile bottom sheet action implementations |
| `widgets.dart` | Widget barrel export |

### Menu & Actions

| File | Description |
|------|-------------|
| `simple_table_more_action.dart` | `SimpleTableMoreAction` enum (all 25 values), `SimpleTableMoreActionMenu` widget, `SimpleTableActionMenu` (mobile) |

### Keyboard Shortcuts

| File | Description |
|------|-------------|
| `simple_table_commands.dart` | `simpleTableCommands` list (registers all shortcuts) |
| `simple_table_command_extension.dart` | Helper extensions for navigation |
| `simple_table_arrow_up_command.dart` | Arrow up handler |
| `simple_table_arrow_down_command.dart` | Arrow down handler |
| `simple_table_arrow_left_command.dart` | Arrow left handler |
| `simple_table_arrow_right_command.dart` | Arrow right handler |
| `simple_table_enter_command.dart` | Enter key handler |
| `simple_table_tab_command.dart` | Tab / Shift+Tab handler |
| `simple_table_backspace_command.dart` | Backspace handler |
| `simple_table_select_all_command.dart` | Ctrl/Cmd+A handler |
| `simple_table_navigation_command.dart` | Cross-border navigation |

### Parsers

| File | Description |
|------|-------------|
| `markdown_simple_table_parser.dart` | Markdown → table node parser |
| `simple_table_node_parser.dart` | Table node → markdown converter |

### Slash Menu Integration

| File | Description |
|------|-------------|
| `simple_table_item.dart` | `/table` slash command (creates 2x2 table) |

### Legacy Table (not SimpleTable)

| File | Description |
|------|-------------|
| `table/table_menu.dart` | Legacy table context menu |
| `table/table_option_action.dart` | Legacy `TableOptionAction` enum (addAfter, addBefore, delete, duplicate, clear, bgColor) |

### Tests

| File | Description |
|------|-------------|
| `test/unit_test/simple_table/simple_table_insert_operation_test.dart` | Insert operation tests |
| `test/unit_test/simple_table/simple_table_delete_operation_test.dart` | Delete operation tests |
| `test/unit_test/simple_table/simple_table_duplicate_operation_test.dart` | Duplicate operation tests |
| `test/unit_test/simple_table/simple_table_reorder_operation_test.dart` | Reorder operation tests |
| `test/unit_test/simple_table/simple_table_style_operation_test.dart` | Style operation tests |
| `test/unit_test/simple_table/simple_table_header_operation_test.dart` | Header operation tests |
| `test/unit_test/simple_table/simple_table_contente_operation_test.dart` | Content operation tests |
| `test/unit_test/simple_table/simple_table_markdown_test.dart` | Markdown parsing tests |
| `test/unit_test/simple_table/simple_table_test_helper.dart` | Test utilities |
| `integration_test/desktop/document/document_with_simple_table_test.dart` | Desktop integration tests |
| `integration_test/mobile/document/simple_table_test.dart` | Mobile integration tests |

---
---

# Part II: Open-Source React Document Table Research

This section surveys open-source React (and React-compatible) projects that implement a **document table** component -- a table block living inside a rich-text/block editor, similar to AppFlowy's SimpleTable. This is NOT about data grids or spreadsheet libraries.

---

## 12. Research Overview

The following projects were evaluated for feature parity with AppFlowy's SimpleTable. The core features being compared:

- **Rich cell content** -- Can cells contain arbitrary block-level content (headings, images, code blocks)?
- **Add row/column UI** -- Hover buttons or inline controls to insert rows/columns
- **Column resize** -- Drag-to-resize column widths
- **Row/column reorder** -- Drag-and-drop to rearrange rows or columns
- **Header row/column** -- Toggle first row/column as header with distinct styling
- **Per-row/column styling** -- Background color, text color, bold, alignment per row or column
- **Cell merge/split** -- Colspan/rowspan support
- **Keyboard navigation** -- Tab, Shift+Tab, arrow keys between cells
- **Undo/redo** -- Transaction-based history
- **Mobile support** -- Responsive or adaptive table UI

---

## 13. Plate (Slate.js) -- Closest Match

- **GitHub:** https://github.com/udecode/plate
- **Stars:** ~16,100
- **Framework:** Slate.js + React (with shadcn/ui components)
- **License:** MIT
- **Status:** Very active (updated daily, 73k+ npm downloads/week)

### Table Features

| Feature | Supported | Notes |
|---------|-----------|-------|
| Rich cell content | Yes | All Plate block types (paragraphs, headings, images, code blocks, etc.) |
| Add row/column UI | Yes | Via toolbar and context actions |
| Column resize | Yes | Drag-to-resize at table level |
| Row/column reorder | Yes | Drag-and-drop (fixed in recent versions) |
| Header row/column | Yes | Toggle first row as `<thead>` |
| Cell/row/column styling | Yes | Border color/style, background color, padding, text alignment |
| Cell merge/split | No | Not a built-in feature |
| Keyboard navigation | Yes | Tab between cells, keyboard event handling |
| Undo/redo | Yes | Via Slate's built-in history plugin |
| Mobile support | Not explicit | Not specifically documented for tables |

### Architecture

Plugin-based. Composed of `TablePlugin`, `TableRowPlugin`, `TableCellPlugin`, and `TableCellHeaderPlugin` bundled into a `TableKit`. Higher-order editor functions enhance the Slate editor:

- `withNormalizeTable` -- table structure normalization
- `withDeleteTable` -- delete behavior in tables
- `withGetFragmentTable` -- copy/paste handling
- `withInsertFragmentTable` -- paste into table
- `withSelectionTable` -- selection behavior

Data model follows Slate's nested node tree:

```
table (element)
  └── table_row (element)
        └── table_cell / table_header_cell (element)
              └── [arbitrary Slate content]
```

Ships with pre-built **shadcn/ui** React components for immediate use.

### Why Plate is the Closest Match

- Same nested block architecture (Table > Row > Cell > Content) as AppFlowy
- Operations are editor-level transforms, similar to AppFlowy's `EditorState` extensions
- Rich cell content (not inline-only)
- Row/column drag reorder support
- Active community and npm-installable

---

## 14. TipTap (ProseMirror) -- Most Mature Table Engine

- **GitHub:** https://github.com/ueberdosis/tiptap
- **Stars:** ~36,000
- **Framework:** ProseMirror + React (also Vue, Svelte, plain JS)
- **License:** MIT (table extension is free/open-source as of 2025)
- **Status:** Very active (updated daily)

### Table Features

| Feature | Supported | Notes |
|---------|-----------|-------|
| Rich cell content | Yes | All TipTap node types inside cells |
| Add row/column UI | Yes | Commands + UI handles for row/column manipulation |
| Column resize | Yes | Via `prosemirror-tables` columnResizing plugin (`resizable: true`) |
| Row/column reorder | Partial | Drag handles exist for move/duplicate, but native drag-to-reorder is NOT built-in (GitHub #6149) |
| Header row/column | Yes | Toggle current row/column/cell as header |
| Cell merge/split | Yes | Merge selected cells, split merged cells |
| Cell styling | Schema-level | Via ProseMirror schema customization |
| Keyboard navigation | Yes | Tab/Shift+Tab for cell navigation |
| Undo/redo | Yes | Via ProseMirror transaction history |
| Mobile support | Yes | TipTap supports mobile browsers |

### Architecture

Extension-based. The `Table`, `TableRow`, `TableCell`, and `TableHeader` extensions register ProseMirror nodes. Built on top of the foundational `prosemirror-tables` module. The `TableKit` bundles all table-related extensions.

Schema follows ProseMirror's node hierarchy:

```
table
  └── table_row
        └── table_cell / table_header (supports colspan, rowspan)
              └── [block content]
```

The table node component provides an enhanced UI with row/column handles, add/delete/move/duplicate buttons, and cell alignment controls.

### Foundation: prosemirror-tables

- **GitHub:** https://github.com/ProseMirror/prosemirror-tables (~319 stars, MIT)
- Provides: schema extension for rowspan/colspan, cell selection, table normalization, column resizing, commands (addRowBefore/After, deleteRow, addColumnBefore/After, deleteColumn, mergeCells, splitCell, toggleHeaderRow/Column/Cell)
- Does NOT provide: row/column reorder, hover add buttons, React UI components

---

## 15. Lexical (Meta) -- Meta's Editor Framework

- **GitHub:** https://github.com/facebook/lexical (`@lexical/table`, `@lexical/react`)
- **Stars:** ~23,200
- **Framework:** Lexical (Meta's custom framework) + React
- **License:** MIT
- **Status:** Very active (Meta-backed, updated daily)

### Table Features

| Feature | Supported | Notes |
|---------|-----------|-------|
| Rich cell content | Yes | Lexical nodes (paragraphs, text, etc.) but **no nested tables** |
| Add row/column UI | Yes | Contextual menu for modifying tables |
| Column resize | Yes | `TableCellResizerPlugin` |
| Row/column reorder | No | Not documented as built-in |
| Header row/column | Yes | Supported via `TableNode` schema |
| Cell merge/split | Yes | Colspan/rowspan support (enabled by default) |
| Cell styling | Yes | Cell background color, row striping |
| Keyboard navigation | Yes | Tab/Shift+Tab (registered at `COMMAND_PRIORITY_HIGH`), arrow key commands |
| Undo/redo | Yes | Via Lexical's command/history system |
| Horizontal scroll | Yes | Tables can be wrapped in scrollable div |
| Mobile support | Yes | Lexical targets web broadly |

### Architecture

Node-based. `TableNode`, `TableRowNode`, and `TableCellNode` mirror DOM `<table>/<tr>/<td>` elements:

```
TableNode
  └── TableRowNode
        └── TableCellNode (supports colSpan, rowSpan, headerState)
              └── [Lexical nodes]
```

The `LexicalTablePlugin` (React component) registers the nodes and enables features. `TableCellResizerPlugin` is a separate plugin for resize. The `TableObserver` manages cell selection state. Everything integrates through Lexical's command system.

Key limitation: **No nested table support** (explicitly blocked).

---

## 16. BlockNote (ProseMirror/TipTap) -- Best Notion-like UX

- **GitHub:** https://github.com/TypeCellOS/BlockNote
- **Stars:** ~9,300
- **Framework:** ProseMirror + TipTap + React
- **License:** MPL-2.0 (core, free for any project) / GPL-3.0 (XL packages, free for open source)
- **Status:** Very active (updated daily)

### Table Features

| Feature | Supported | Notes |
|---------|-----------|-------|
| Rich cell content | **Inline only** | Cells contain inline content, NOT arbitrary blocks -- **key limitation** |
| Add row/column UI | Yes | Via block-level side menu / drag handle |
| Column resize | Yes | Column widths stored in data model |
| Row/column reorder | Yes | Drag and drop for columns |
| Header row/column | Yes | Configurable via `headers: true`; `headerRows`/`headerCols` in data model |
| Cell merge/split | Yes | Opt-in via `splitCells: true` |
| Cell background color | Yes | Opt-in via `cellBackgroundColor: true` |
| Cell text color | Yes | Opt-in via `cellTextColor: true` |
| Text alignment | Yes | Per-cell text alignment property |
| Keyboard navigation | Yes | Tab navigation between cells |
| Undo/redo | Yes | Via ProseMirror/TipTap history |
| Collaborative editing | Yes | Via Y.js CRDT |
| Mobile support | Yes | Responsive, React-based |

### Architecture

Block-based. Tables are a built-in block type with `TableContent`:

```json
{
  "type": "table",
  "content": {
    "columnWidths": [100, 200, 150],
    "headerRows": 1,
    "headerCols": 0,
    "rows": [
      {
        "cells": [
          {
            "type": "tableCell",
            "content": [/* inline content only */],
            "props": {
              "backgroundColor": "#f0f0f0",
              "textColor": "#333",
              "textAlignment": "center",
              "colspan": 1,
              "rowspan": 1
            }
          }
        ]
      }
    ]
  }
}
```

Advanced features (merge/split, colors) are disabled by default and enabled via editor config. Built on TipTap's extension system under the hood.

### Key Limitation

**Cells only support inline content** -- no images, code blocks, headings, or other block-level elements inside a cell. This is a significant gap compared to AppFlowy's SimpleTable, where cells can contain any document block.

---

## 17. AFFiNE / BlockSuite -- Most Ambitious (Not React)

- **GitHub (AFFiNE):** https://github.com/toeverything/AFFiNE (~66,900 stars)
- **GitHub (BlockSuite):** https://github.com/toeverything/blocksuite (~5,750 stars)
- **Framework:** BlockSuite (custom framework, **Web Components -- NOT React**)
- **License:** AFFiNE: custom (NOASSERTION), BlockSuite: MPL-2.0
- **Status:** Very active (updated daily)

### Table Features

| Feature | Supported | Notes |
|---------|-----------|-------|
| Rich cell content | Yes | Supports block content in cells |
| Add row/column UI | Yes | Inline controls |
| Column resize | Yes | Drag resize handle |
| Column reorder | Yes | Drag columns to new positions |
| Header row/column | Yes | |
| Context menu | Yes | Full table operation menu |
| Keyboard navigation | Yes | Part of the full editor experience |
| Undo/redo | Yes | CRDT-based via Yjs, with time-travel |
| Collaborative editing | Yes | Native (CRDT built into data layer) |

### Architecture

`@blocksuite/affine-block-table` provides the table block. Components include `TableDataManager` and `TableSelection`. The data layer is natively built on Yjs CRDT.

### Why It's Listed but with Caveats

BlockSuite uses **Web Components**, not React. It cannot be directly used as a React component without a wrapper layer. It is the editor behind AFFiNE (similar to how Monaco is behind VSCode). Architecturally it's the most similar to AppFlowy's approach (custom framework, block-based, collaborative), but the technology stack differs.

---

## 18. Other Notable Projects

### Yoopta Editor (Slate.js)

- **GitHub:** https://github.com/yoopta-editor/Yoopta-Editor (~2,970 stars)
- **Framework:** Slate.js + React
- **License:** MIT
- **Table plugin:** `@yoopta/table`
- **Features:** Insert/delete rows and columns, move rows and columns, update column widths, toggle header rows/columns, horizontal scroll support
- **Architecture:** Plugin-based. Static methods on the table plugin for all operations. Headless with optional shadcn theme preset.

### Novel (TipTap wrapper)

- **GitHub:** https://github.com/steven-tey/novel (~16,100 stars)
- **Framework:** TipTap + React + Next.js + Tailwind
- **License:** Apache-2.0
- **Table support:** Delegates to TipTap extensions. Not a table implementation itself. Focused on AI-powered writing, not comprehensive table editing.

### Outline (ProseMirror)

- **GitHub:** https://github.com/outline/outline (~37,900 stars)
- **Framework:** ProseMirror + React
- **License:** BSL (Business Source License)
- **Table features:** Add row/column UI, column resize, header row/column toggle, cell merge/split, keyboard navigation
- **Caveat:** Editor is deeply integrated into Outline's codebase (not extractable as standalone library). The old standalone editor repo is archived.

### Legacy Slate.js Table Plugins

| Project | GitHub | Stars | Status | Notes |
|---------|--------|-------|--------|-------|
| slate-edit-table (GitbookIO) | github.com/GitbookIO/slate-edit-table | ~109 | Archived | Old Slate version, not usable with current Slate |
| slate-deep-table | github.com/jasonphillips/slate-deep-table | ~112 | Unmaintained | Forked from above, supports nested block content in cells |
| nlulic/slate-table | github.com/nlulic/slate-table | ~31 | Active (2026) | Modern Slate compatible, merge/split cells, no resize |

### AppFlowy Web Editor

- **GitHub:** https://github.com/AppFlowy-IO/AppFlowy-Web-Editor (~10 stars)
- **Framework:** Slate.js + React
- **Status:** Early stage. Has GFM table parsing dependencies but full SimpleTable parity with the Flutter version is not yet implemented.

---

## 19. Feature Comparison Matrix

### AppFlowy SimpleTable vs All React Projects

| Feature | AppFlowy (Flutter) | Plate | TipTap | Lexical | BlockNote | AFFiNE | Yoopta | Outline |
|---------|-------------------|-------|--------|---------|-----------|--------|--------|---------|
| **Rich block cells** | Yes | Yes | Yes | Yes (no nested tables) | **Inline only** | Yes | Yes | Markdown |
| **Add row/col buttons** | Hover buttons | Toolbar/context | UI handles | Context menu | Side menu | Inline | Yes | Click/dot indicator |
| **Column resize** | Drag handle | Yes | Yes | Yes (plugin) | Yes | Yes | Yes | Yes |
| **Row/col reorder** | Drag grip | Yes | **Partial** | **No** | Yes (columns) | Yes (columns) | Yes | **No** |
| **Header row/column** | Toggle both | Row only | Both + cell | Row | Both | Yes | Both | Both |
| **Per-row/col styling** | BG, text color, bold, align | BG, border, align | Schema-level | BG, striping | BG, text, align | - | - | - |
| **Cell merge/split** | No | No | Yes | Yes | Yes (opt-in) | - | No | Yes |
| **Keyboard nav** | Tab, arrows, Enter, Backspace, Ctrl+A | Tab | Tab/Shift+Tab | Tab/Shift+Tab, arrows | Tab | Yes | Yes | Yes |
| **Undo/redo** | Editor transactions | Slate history | PM history | Lexical history | PM/TipTap history | CRDT | Slate history | PM history |
| **Mobile support** | Yes (separate UI) | Not explicit | Yes | Web | Yes | Yes | - | - |
| **Duplicate row/col** | Yes | - | Yes (via handles) | - | - | - | - | - |
| **Copy/paste row/col** | Yes (clipboard) | - | - | - | - | - | - | - |
| **Set to page width** | Yes | - | - | - | - | - | - | - |
| **Distribute evenly** | Yes | - | - | - | - | - | - | - |

### Summary Scores (0-3 scale, 3 = full parity with AppFlowy)

| Project | Cell Content | CRUD Actions | Styling | Navigation | Reorder | Overall |
|---------|-------------|--------------|---------|------------|---------|---------|
| **Plate** | 3 | 2 | 2 | 2 | 3 | **12/15** |
| **TipTap** | 3 | 3 | 1 | 2 | 1 | **10/15** |
| **Lexical** | 2 | 2 | 1 | 3 | 0 | **8/15** |
| **BlockNote** | 1 | 2 | 2 | 2 | 2 | **9/15** |
| **AFFiNE** | 3 | 2 | 1 | 2 | 2 | **10/15** (not React) |
| **Yoopta** | 2 | 2 | 1 | 1 | 2 | **8/15** |

---

## 20. Key Takeaways & Recommendations

### 1. Plate is the closest match to AppFlowy's SimpleTable

Plate (Slate.js) has the most feature parity: rich block content in cells, drag reorder for rows and columns, column resize, header toggle, per-cell styling, and keyboard navigation. It's MIT licensed and installable via npm. If building an AppFlowy-like table in React, Plate is the strongest starting point.

### 2. TipTap has the most mature and battle-tested table engine

Built on `prosemirror-tables` (the gold standard for document tables), TipTap has the largest ecosystem and most production deployments. Merge/split is a standout feature. The main gap is **row/column drag reorder**, which is not natively supported.

### 3. BlockNote has the best out-of-box Notion UX but a critical limitation

BlockNote provides the most polished Notion-like editing experience, with per-cell styling, merge/split (opt-in), and collaborative editing via Y.js. However, **cells only support inline content** (no images, code blocks, etc.), which is a significant gap vs AppFlowy.

### 4. No single project matches ALL of AppFlowy's features

The combination of these features is unique to AppFlowy:
- Per-**row** and per-**column** styling (background color, text color, bold, alignment)
- Row/column duplicate and copy/paste to clipboard
- "Set to page width" and "distribute columns evenly" layout actions
- Separate desktop hover UI vs mobile bottom sheet UI

### 5. Architecture patterns are consistent across projects

All projects use the same fundamental data model:

```
Table Node → Row Node → Cell Node → [Content]
```

Operations are implemented as editor-level transforms (Slate transforms, ProseMirror transactions, Lexical commands). This validates AppFlowy's architecture as aligned with industry patterns.

### 6. Recommended approach for React implementation

| Priority | Recommendation |
|----------|---------------|
| **Start from Plate** | Use `@udecode/plate-table` as the base. It covers ~80% of the feature surface. |
| **Add per-row/col styling** | Plate has cell-level styling; extend with row/column attribute maps similar to AppFlowy's `columnColors`, `rowColors`, `columnAligns`, etc. |
| **Add AppFlowy-specific actions** | Implement "set to page width", "distribute evenly", "duplicate row/column", "copy/paste row/column" as custom Slate transforms. |
| **Reference TipTap for merge/split** | If merge/split is needed later, study TipTap's / prosemirror-tables' implementation. |
| **Reference BlockNote for UX patterns** | BlockNote's hover UI, color pickers, and inline controls provide good UX inspiration even if the underlying engine differs. |
