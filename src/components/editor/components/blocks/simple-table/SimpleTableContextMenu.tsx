import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { TableAlignType } from '@/application/types';
import Popover from '@/components/_shared/popover/Popover';
import { Switch } from '@/components/_shared/switch/Switch';
import { renderColor } from '@/utils/color';

import { resizeSimpleTable } from './SimpleTable.layout';
import { scrollSimpleTableFromMenu } from './SimpleTable.scroll';
import { useSimpleTableContext } from './SimpleTableContext';
import { SimpleTableMenuIcons } from './SimpleTableMenuIcons';

// Background color palette matching desktop Flutter (free tier)
const TABLE_BG_COLORS = [
  { id: '', label: 'Default' },
  { id: 'bg-color-14', label: 'Purple' },
  { id: 'bg-color-16', label: 'Violet' },
  { id: 'bg-color-18', label: 'Pink' },
  { id: 'bg-color-2', label: 'Orange' },
  { id: 'bg-color-4', label: 'Yellow' },
  { id: 'bg-color-6', label: 'Olive' },
  { id: 'bg-color-8', label: 'Green' },
  { id: 'bg-color-10', label: 'Teal' },
  { id: 'bg-color-12', label: 'Blue' },
];

// ============================================================================
// Menu components
// ============================================================================

export interface MenuAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  divider?: boolean;
  colorPicker?: boolean;
  onSelectColor?: (colorId: string) => void;
  selectedColor?: string;
  alignPicker?: boolean;
  onSelectAlign?: (align: TableAlignType) => void;
  selectedAlign?: TableAlignType;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

function MenuDivider() {
  return <div className="simple-table-menu-divider" />;
}

export function SimpleTableMenuItem({ action }: { action: MenuAction }) {
  if (action.colorPicker) {
    return <ColorMenuItem action={action} />;
  }

  if (action.alignPicker) {
    return <AlignMenuItem action={action} />;
  }

  if (action.onCheckedChange) {
    return (
      <label className="simple-table-menu-item simple-table-menu-toggle">
        {action.icon && <span className="simple-table-menu-item-icon">{action.icon}</span>}
        <span>{action.label}</span>
        <Switch
          size="small"
          className="simple-table-menu-switch"
          checked={action.checked ?? false}
          onChange={(_, checked) => action.onCheckedChange?.(checked)}
          inputProps={{ role: 'switch', 'aria-label': action.label }}
          sx={(theme) => ({
            '& .MuiSwitch-track': {
              backgroundColor: '#e0e0e0',
              ...theme.applyStyles('dark', { backgroundColor: '#39393d' }),
            },
          })}
        />
      </label>
    );
  }

  return (
    <button
      className={`simple-table-menu-item ${action.destructive ? 'simple-table-menu-delete' : ''}`}
      onClick={action.onClick}
      disabled={action.disabled}
    >
      {action.icon && <span className="simple-table-menu-item-icon">{action.icon}</span>}
      <span>{action.label}</span>
    </button>
  );
}

function ColorMenuItem({ action }: { action: MenuAction }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const isOpen = Boolean(anchorEl);

  return (
    <>
      <button
        ref={ref}
        className="simple-table-menu-item"
        onClick={() => setAnchorEl(ref.current)}
      >
        {action.icon && <span className="simple-table-menu-item-icon">{action.icon}</span>}
        <span>{action.label}</span>
        {SimpleTableMenuIcons.submenuArrow}
      </button>
      <Popover
        open={isOpen}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { className: 'simple-table-context-menu' } }}
      >
        <div className="simple-table-color-picker">
          <div className="simple-table-color-picker-title">Background color</div>
          <div className="simple-table-color-picker-grid">
            {TABLE_BG_COLORS.map((color) => {
              const bgValue = color.id ? renderColor(color.id) : 'transparent';
              const isSelected = action.selectedColor === color.id ||
                (!action.selectedColor && !color.id);

              return (
                <button
                  key={color.id || 'default'}
                  className={`simple-table-color-swatch ${isSelected ? 'selected' : ''}`}
                  title={color.label}
                  style={{ backgroundColor: bgValue }}
                  onClick={() => {
                    action.onSelectColor?.(color.id);
                    setAnchorEl(null);
                  }}
                />
              );
            })}
          </div>
        </div>
      </Popover>
    </>
  );
}

function AlignLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M3 4h10M3 8h6M3 12h8" />
    </svg>
  );
}

function AlignCenterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M3 4h10M5 8h6M4 12h8" />
    </svg>
  );
}

function AlignRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M3 4h10M7 8h6M5 12h8" />
    </svg>
  );
}

function AlignMenuItem({ action }: { action: MenuAction }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const isOpen = Boolean(anchorEl);

  const alignOptions = [
    { value: TableAlignType.Left, label: 'Left', icon: <AlignLeftIcon /> },
    { value: TableAlignType.Center, label: 'Center', icon: <AlignCenterIcon /> },
    { value: TableAlignType.Right, label: 'Right', icon: <AlignRightIcon /> },
  ];

  return (
    <>
      <button
        ref={ref}
        className="simple-table-menu-item"
        onClick={() => setAnchorEl(ref.current)}
      >
        {action.icon && <span className="simple-table-menu-item-icon">{action.icon}</span>}
        <span>{action.label}</span>
        {SimpleTableMenuIcons.submenuArrow}
      </button>
      <Popover
        open={isOpen}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { className: 'simple-table-context-menu' } }}
      >
        <div className="simple-table-menu-list" style={{ minWidth: '140px' }}>
          {alignOptions.map((opt) => (
            <button
              key={opt.value}
              className={`simple-table-menu-item ${action.selectedAlign === opt.value ? 'active' : ''}`}
              onClick={() => {
                action.onSelectAlign?.(opt.value);
                setAnchorEl(null);
              }}
            >
              <span className="simple-table-menu-item-icon">{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

// ============================================================================
// Action trigger icon buttons
// ============================================================================

/**
 * Row grip icon — two horizontal lines inside a circle.
 * Positioned at the LEFT of the row.
 */
const RowGripButton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { isOpen: boolean }>(
  ({ isOpen, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      contentEditable={false}
      className={`simple-table-action-btn ${isOpen ? 'active' : ''}`}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M4 5.5h6M4 8.5h6" />
      </svg>
    </div>
  ),
);

/**
 * Column grip icon — two vertical lines inside a circle.
 * Positioned at the TOP of the column.
 */
const ColGripButton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { isOpen: boolean }>(
  ({ isOpen, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      contentEditable={false}
      className={`simple-table-action-btn ${isOpen ? 'active' : ''}`}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M5.5 4v6M8.5 4v6" />
      </svg>
    </div>
  ),
);

// ============================================================================
// Row action trigger
// ============================================================================

export function RowActionTrigger({ rowIndex }: { rowIndex: number }) {
  const context = useSimpleTableContext();
  const editor = useSlateStatic() as YjsEditor;
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  const isOpen = Boolean(anchorEl);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAnchorEl(buttonRef.current);
    context?.setIsMenuOpen(true);
  }, [context]);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
    context?.setIsMenuOpen(false);
    // Clear hover state so overlay recalculates on next hover
    context?.setHoveringCell(null);
  }, [context]);

  const tableBlockId = context?.tableNode.blockId ?? '';
  const rowCount = context?.rowCount ?? 0;

  const actions = useMemo<MenuAction[]>(() => {
    const items: MenuAction[] = [
      {
        label: 'Insert above',
        icon: SimpleTableMenuIcons.insertRowAbove,
        onClick: () => {
          CustomEditor.insertTableRow(editor, tableBlockId, rowIndex);
          handleClose();
        },
      },
      {
        label: 'Insert below',
        icon: SimpleTableMenuIcons.insertRowBelow,
        onClick: () => {
          CustomEditor.insertTableRow(editor, tableBlockId, rowIndex + 1);
          handleClose();
        },
      },
      { label: '', divider: true, onClick: () => undefined },
      ...(rowIndex === 0
        ? [{
            label: 'Header row',
            icon: SimpleTableMenuIcons.headerRow,
            checked: context?.tableNode.data.enable_header_row ?? false,
            onCheckedChange: (checked: boolean) => {
              CustomEditor.updateTableData(editor, tableBlockId, { enable_header_row: checked });
            },
            onClick: () => undefined,
          }]
        : []),
      {
        label: 'Color',
        icon: SimpleTableMenuIcons.color,
        colorPicker: true,
        selectedColor: (context?.tableNode.data.row_colors?.[rowIndex] as string) || '',
        onSelectColor: (colorId: string) => {
          const rowColors = { ...(context?.tableNode.data.row_colors || {}) };

          if (colorId) {
            rowColors[rowIndex] = colorId;
          } else {
            delete rowColors[rowIndex];
          }

          CustomEditor.updateTableData(editor, tableBlockId, { row_colors: rowColors });
          handleClose();
        },
        onClick: () => undefined,
      },
      {
        label: 'Align',
        icon: SimpleTableMenuIcons.align,
        alignPicker: true,
        selectedAlign: context?.tableNode.data.row_aligns?.[rowIndex],
        onSelectAlign: (align: TableAlignType) => {
          const rowAligns = { ...(context?.tableNode.data.row_aligns || {}) };

          rowAligns[rowIndex] = align;
          CustomEditor.updateTableData(editor, tableBlockId, { row_aligns: rowAligns });
          handleClose();
        },
        onClick: () => undefined,
      },
      { label: '', divider: true, onClick: () => undefined },
      {
        label: 'Set to page width',
        icon: SimpleTableMenuIcons.setPageWidth,
        onClick: () => {
          resizeSimpleTable(editor, tableBlockId, 'page');
          handleClose();
        },
      },
      {
        label: 'Distribute columns evenly',
        icon: SimpleTableMenuIcons.distribute,
        onClick: () => {
          resizeSimpleTable(editor, tableBlockId, 'even');
          handleClose();
        },
      },
      { label: '', divider: true, onClick: () => undefined },
      {
        label: 'Duplicate',
        icon: SimpleTableMenuIcons.duplicate,
        onClick: () => {
          CustomEditor.duplicateTableRow(editor, tableBlockId, rowIndex);
          handleClose();
        },
      },
      {
        label: 'Clear contents',
        icon: SimpleTableMenuIcons.clearContents,
        onClick: () => {
          CustomEditor.clearTableRowContent(editor, tableBlockId, rowIndex);
          handleClose();
        },
      },
      {
        label: 'Delete',
        icon: SimpleTableMenuIcons.deleteRow,
        destructive: true,
        onClick: () => {
          CustomEditor.deleteTableRow(editor, tableBlockId, rowIndex);
          handleClose();
        },
        disabled: rowCount <= 1,
      },
    ];

    return items;
  }, [editor, tableBlockId, rowIndex, rowCount, context, handleClose]);

  if (!context || context.readOnly) return null;

  return (
    <>
      <RowGripButton ref={buttonRef} isOpen={isOpen} onClick={handleClick} />
      <Popover
        open={isOpen}
        anchorEl={anchorEl}
        onClose={handleClose}
        onWheel={(event) => scrollSimpleTableFromMenu(event, buttonRef.current?.closest('.simple-table') ?? null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            className: 'simple-table-context-menu',
          },
        }}
      >
        <div className="simple-table-menu-list">
          {actions.map((action, i) =>
            action.divider ? <MenuDivider key={i} /> : <SimpleTableMenuItem key={i} action={action} />,
          )}
        </div>
      </Popover>
    </>
  );
}

// ============================================================================
// Column action trigger
// ============================================================================

export function ColumnActionTrigger({ colIndex }: { colIndex: number }) {
  const context = useSimpleTableContext();
  const editor = useSlateStatic() as YjsEditor;
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  const isOpen = Boolean(anchorEl);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAnchorEl(buttonRef.current);
    context?.setIsMenuOpen(true);
  }, [context]);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
    context?.setIsMenuOpen(false);
    context?.setHoveringCell(null);
  }, [context]);

  const tableBlockId = context?.tableNode.blockId ?? '';
  const colCount = context?.columnCount ?? 0;

  const actions = useMemo<MenuAction[]>(() => {
    const items: MenuAction[] = [
      {
        label: 'Insert left',
        icon: SimpleTableMenuIcons.insertColumnLeft,
        onClick: () => {
          CustomEditor.insertTableColumn(editor, tableBlockId, colIndex);
          handleClose();
        },
      },
      {
        label: 'Insert right',
        icon: SimpleTableMenuIcons.insertColumnRight,
        onClick: () => {
          CustomEditor.insertTableColumn(editor, tableBlockId, colIndex + 1);
          handleClose();
        },
      },
      { label: '', divider: true, onClick: () => undefined },
      ...(colIndex === 0
        ? [{
            label: 'Header column',
            icon: SimpleTableMenuIcons.headerColumn,
            checked: context?.tableNode.data.enable_header_column ?? false,
            onCheckedChange: (checked: boolean) => {
              CustomEditor.updateTableData(editor, tableBlockId, { enable_header_column: checked });
            },
            onClick: () => undefined,
          }]
        : []),
      {
        label: 'Color',
        icon: SimpleTableMenuIcons.color,
        colorPicker: true,
        selectedColor: (context?.tableNode.data.column_colors?.[colIndex] as string) || '',
        onSelectColor: (colorId: string) => {
          const colColors = { ...(context?.tableNode.data.column_colors || {}) };

          if (colorId) {
            colColors[colIndex] = colorId;
          } else {
            delete colColors[colIndex];
          }

          CustomEditor.updateTableData(editor, tableBlockId, { column_colors: colColors });
          handleClose();
        },
        onClick: () => undefined,
      },
      {
        label: 'Align',
        icon: SimpleTableMenuIcons.align,
        alignPicker: true,
        selectedAlign: context?.tableNode.data.column_aligns?.[colIndex],
        onSelectAlign: (align: TableAlignType) => {
          const colAligns = { ...(context?.tableNode.data.column_aligns || {}) };

          colAligns[colIndex] = align;
          CustomEditor.updateTableData(editor, tableBlockId, { column_aligns: colAligns });
          handleClose();
        },
        onClick: () => undefined,
      },
      { label: '', divider: true, onClick: () => undefined },
      {
        label: 'Set to page width',
        icon: SimpleTableMenuIcons.setPageWidth,
        onClick: () => {
          resizeSimpleTable(editor, tableBlockId, 'page');
          handleClose();
        },
      },
      {
        label: 'Distribute columns evenly',
        icon: SimpleTableMenuIcons.distribute,
        onClick: () => {
          resizeSimpleTable(editor, tableBlockId, 'even');
          handleClose();
        },
      },
      { label: '', divider: true, onClick: () => undefined },
      {
        label: 'Duplicate',
        icon: SimpleTableMenuIcons.duplicate,
        onClick: () => {
          CustomEditor.duplicateTableColumn(editor, tableBlockId, colIndex);
          handleClose();
        },
      },
      {
        label: 'Clear contents',
        icon: SimpleTableMenuIcons.clearContents,
        onClick: () => {
          CustomEditor.clearTableColumnContent(editor, tableBlockId, colIndex);
          handleClose();
        },
      },
      {
        label: 'Delete',
        icon: SimpleTableMenuIcons.deleteColumn,
        destructive: true,
        onClick: () => {
          CustomEditor.deleteTableColumn(editor, tableBlockId, colIndex);
          handleClose();
        },
        disabled: colCount <= 1,
      },
    ];

    return items;
  }, [editor, tableBlockId, colIndex, colCount, context, handleClose]);

  if (!context || context.readOnly) return null;

  return (
    <>
      <ColGripButton ref={buttonRef} isOpen={isOpen} onClick={handleClick} />
      <Popover
        open={isOpen}
        anchorEl={anchorEl}
        onClose={handleClose}
        onWheel={(event) => scrollSimpleTableFromMenu(event, buttonRef.current?.closest('.simple-table') ?? null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{
          paper: {
            className: 'simple-table-context-menu',
          },
        }}
      >
        <div className="simple-table-menu-list">
          {actions.map((action, i) =>
            action.divider ? <MenuDivider key={i} /> : <SimpleTableMenuItem key={i} action={action} />,
          )}
        </div>
      </Popover>
    </>
  );
}
