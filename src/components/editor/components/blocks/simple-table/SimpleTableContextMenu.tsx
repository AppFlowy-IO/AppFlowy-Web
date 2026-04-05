import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { TableAlignType } from '@/application/types';
import Popover from '@/components/_shared/popover/Popover';
import { renderColor } from '@/utils/color';

import { MIN_WIDTH } from './const';
import { useSimpleTableContext } from './SimpleTableContext';

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
// SVG Icons matching the desktop Flutter UI
// ============================================================================

function InsertAboveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="12" height="8" rx="1" />
      <path d="M8 1v3M6 3h4" />
    </svg>
  );
}

function InsertBelowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="8" rx="1" />
      <path d="M8 12v3M6 13h4" />
    </svg>
  );
}

function InsertLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2" width="8" height="12" rx="1" />
      <path d="M1 8h3M3 6v4" />
    </svg>
  );
}

function InsertRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="8" height="12" rx="1" />
      <path d="M12 8h3M13 6v4" />
    </svg>
  );
}

function ColorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="3" y="3" width="10" height="10" rx="2" />
    </svg>
  );
}

function AlignIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M3 4h10M3 8h7M3 12h10" />
    </svg>
  );
}

function SetToPageWidthIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h10M3 8l2-2M3 8l2 2M13 8l-2-2M13 8l-2 2" />
    </svg>
  );
}

function DistributeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M2 3v10M8 3v10M14 3v10" />
      <rect x="3" y="5" width="4" height="6" rx="0.5" />
      <rect x="9" y="5" width="4" height="6" rx="0.5" />
    </svg>
  );
}

function DuplicateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
    </svg>
  );
}

function ClearContentsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3L3.5 13h9L8 3z" />
      <path d="M5.5 10h5" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1" />
      <path d="M4.5 4l.5 9a1 1 0 001 1h4a1 1 0 001-1l.5-9" />
      <path d="M6.5 7v4M9.5 7v4" />
    </svg>
  );
}

// ============================================================================
// Menu components
// ============================================================================

interface MenuAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  divider?: boolean;
  colorPicker?: boolean;
  onSelectColor?: (colorId: string) => void;
  selectedColor?: string;
  alignPicker?: boolean;
  onSelectAlign?: (align: TableAlignType) => void;
  selectedAlign?: TableAlignType;
}

function MenuDivider() {
  return <div className="simple-table-menu-divider" />;
}

function MenuItem({ action }: { action: MenuAction }) {
  if (action.colorPicker) {
    return <ColorMenuItem action={action} />;
  }

  if (action.alignPicker) {
    return <AlignMenuItem action={action} />;
  }

  return (
    <button
      className="simple-table-menu-item"
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
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="ml-auto text-text-caption">
          <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
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
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="ml-auto text-text-caption">
          <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
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
// Row/Column highlight when menu is open
// ============================================================================

function useHighlight(type: 'row' | 'column', index: number, isOpen: boolean) {
  const context = useSimpleTableContext();

  useEffect(() => {
    if (!isOpen || !context) return;

    // Find the table by walking up from any element with the blockId,
    // or by finding the closest .simple-table ancestor
    const blockEl = document.querySelector(`[data-block-id="${context.tableNode.blockId}"]`);
    const tableEl = blockEl?.closest('.simple-table') || blockEl?.querySelector('.simple-table') || blockEl;

    if (!tableEl) return;

    if (type === 'row') {
      const row = tableEl.querySelector(`tr[data-row-index="${index}"]`);

      if (row) {
        row.classList.add('simple-table-highlight');
      }

      return () => {
        row?.classList.remove('simple-table-highlight');
      };
    } else {
      const cells = tableEl.querySelectorAll(`td[data-cell-index="${index}"]`);

      cells.forEach(cell => cell.classList.add('simple-table-highlight'));

      return () => {
        cells.forEach(cell => cell.classList.remove('simple-table-highlight'));
      };
    }
  }, [isOpen, type, index, context]);
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

  useHighlight('row', rowIndex, isOpen);

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
  const rowCount = (context?.tableNode.children?.length ?? 0);
  const firstRow = context?.tableNode.children?.[0];
  const colCount = firstRow ? (firstRow as { children: unknown[] }).children?.length ?? 0 : 0;

  const actions = useMemo<MenuAction[]>(() => {
    const items: MenuAction[] = [
      {
        label: 'Insert above',
        icon: <InsertAboveIcon />,
        onClick: () => {
          CustomEditor.insertTableRow(editor, tableBlockId, rowIndex);
          handleClose();
        },
      },
      {
        label: 'Insert below',
        icon: <InsertBelowIcon />,
        onClick: () => {
          CustomEditor.insertTableRow(editor, tableBlockId, rowIndex + 1);
          handleClose();
        },
      },
      { label: '', divider: true, onClick: () => undefined },
      {
        label: 'Color',
        icon: <ColorIcon />,
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
        icon: <AlignIcon />,
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
        icon: <SetToPageWidthIcon />,
        onClick: () => {
          // Find the scroll container that holds this table
          const firstCellOfTable = context?.tableNode?.children?.[0];
          const firstCellBlockId = firstCellOfTable ? (firstCellOfTable as { children?: Array<{ blockId?: string }> }).children?.[0]?.blockId : null;
          const cellEl = firstCellBlockId ? document.querySelector(`[data-block-cell="${firstCellBlockId}"]`) : null;
          const containerWidth = (cellEl?.closest('.simple-table-scroll-container') ?? cellEl?.closest('.simple-table'))?.clientWidth;

          if (containerWidth && colCount > 0) {
            const existingWidths = context?.tableNode.data.column_widths || {};
            const totalCurrentWidth = Array.from({ length: colCount }, (_, i) =>
              Number(existingWidths[i]) || MIN_WIDTH
            ).reduce((a, b) => a + b, 0);

            const ratio = containerWidth / totalCurrentWidth;
            const newWidths: Record<string, number> = {};

            for (let i = 0; i < colCount; i++) {
              newWidths[i] = Math.max(MIN_WIDTH, Math.floor((Number(existingWidths[i]) || MIN_WIDTH) * ratio));
            }

            CustomEditor.updateTableData(editor, tableBlockId, { column_widths: newWidths });
          }

          handleClose();
        },
      },
      {
        label: 'Distribute columns evenly',
        icon: <DistributeIcon />,
        onClick: () => {
          // Find the scroll container that holds this table
          const firstCellOfTable = context?.tableNode?.children?.[0];
          const firstCellBlockId = firstCellOfTable ? (firstCellOfTable as { children?: Array<{ blockId?: string }> }).children?.[0]?.blockId : null;
          const cellEl = firstCellBlockId ? document.querySelector(`[data-block-cell="${firstCellBlockId}"]`) : null;
          const containerWidth = (cellEl?.closest('.simple-table-scroll-container') ?? cellEl?.closest('.simple-table'))?.clientWidth;

          if (containerWidth && colCount > 0) {
            const evenWidth = Math.max(MIN_WIDTH, Math.floor(containerWidth / colCount));
            const newWidths: Record<string, number> = {};

            for (let i = 0; i < colCount; i++) {
              newWidths[i] = evenWidth;
            }

            CustomEditor.updateTableData(editor, tableBlockId, { column_widths: newWidths });
          }

          handleClose();
        },
      },
      { label: '', divider: true, onClick: () => undefined },
      {
        label: 'Duplicate',
        icon: <DuplicateIcon />,
        onClick: () => {
          CustomEditor.duplicateTableRow(editor, tableBlockId, rowIndex);
          handleClose();
        },
      },
      {
        label: 'Clear contents',
        icon: <ClearContentsIcon />,
        onClick: () => {
          CustomEditor.clearTableRowContent(editor, tableBlockId, rowIndex);
          handleClose();
        },
      },
      {
        label: 'Delete',
        icon: <DeleteIcon />,
        onClick: () => {
          CustomEditor.deleteTableRow(editor, tableBlockId, rowIndex);
          handleClose();
        },
        disabled: rowCount <= 1,
      },
    ];

    return items;
  }, [editor, tableBlockId, rowIndex, rowCount, colCount, context, handleClose]);

  if (!context || context.readOnly) return null;

  return (
    <>
      <RowGripButton ref={buttonRef} isOpen={isOpen} onClick={handleClick} />
      <Popover
        open={isOpen}
        anchorEl={anchorEl}
        onClose={handleClose}
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
            action.divider ? <MenuDivider key={i} /> : <MenuItem key={i} action={action} />,
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

  useHighlight('column', colIndex, isOpen);

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
  const firstRow = context?.tableNode.children?.[0];
  const colCount = firstRow ? (firstRow as { children: unknown[] }).children?.length ?? 0 : 0;

  const actions = useMemo<MenuAction[]>(() => {
    const items: MenuAction[] = [
      {
        label: 'Insert left',
        icon: <InsertLeftIcon />,
        onClick: () => {
          CustomEditor.insertTableColumn(editor, tableBlockId, colIndex);
          handleClose();
        },
      },
      {
        label: 'Insert right',
        icon: <InsertRightIcon />,
        onClick: () => {
          CustomEditor.insertTableColumn(editor, tableBlockId, colIndex + 1);
          handleClose();
        },
      },
      { label: '', divider: true, onClick: () => undefined },
      {
        label: 'Color',
        icon: <ColorIcon />,
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
        icon: <AlignIcon />,
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
        icon: <SetToPageWidthIcon />,
        onClick: () => {
          // Find the scroll container that holds this table
          const firstCellOfTable = context?.tableNode?.children?.[0];
          const firstCellBlockId = firstCellOfTable ? (firstCellOfTable as { children?: Array<{ blockId?: string }> }).children?.[0]?.blockId : null;
          const cellEl = firstCellBlockId ? document.querySelector(`[data-block-cell="${firstCellBlockId}"]`) : null;
          const containerWidth = (cellEl?.closest('.simple-table-scroll-container') ?? cellEl?.closest('.simple-table'))?.clientWidth;

          if (containerWidth && colCount > 0) {
            const existingWidths = context?.tableNode.data.column_widths || {};
            const totalCurrentWidth = Array.from({ length: colCount }, (_, i) =>
              Number(existingWidths[i]) || MIN_WIDTH
            ).reduce((a, b) => a + b, 0);

            const ratio = containerWidth / totalCurrentWidth;
            const newWidths: Record<string, number> = {};

            for (let i = 0; i < colCount; i++) {
              newWidths[i] = Math.max(MIN_WIDTH, Math.floor((Number(existingWidths[i]) || MIN_WIDTH) * ratio));
            }

            CustomEditor.updateTableData(editor, tableBlockId, { column_widths: newWidths });
          }

          handleClose();
        },
      },
      {
        label: 'Distribute columns evenly',
        icon: <DistributeIcon />,
        onClick: () => {
          // Find the scroll container that holds this table
          const firstCellOfTable = context?.tableNode?.children?.[0];
          const firstCellBlockId = firstCellOfTable ? (firstCellOfTable as { children?: Array<{ blockId?: string }> }).children?.[0]?.blockId : null;
          const cellEl = firstCellBlockId ? document.querySelector(`[data-block-cell="${firstCellBlockId}"]`) : null;
          const containerWidth = (cellEl?.closest('.simple-table-scroll-container') ?? cellEl?.closest('.simple-table'))?.clientWidth;

          if (containerWidth && colCount > 0) {
            const evenWidth = Math.max(MIN_WIDTH, Math.floor(containerWidth / colCount));
            const newWidths: Record<string, number> = {};

            for (let i = 0; i < colCount; i++) {
              newWidths[i] = evenWidth;
            }

            CustomEditor.updateTableData(editor, tableBlockId, { column_widths: newWidths });
          }

          handleClose();
        },
      },
      { label: '', divider: true, onClick: () => undefined },
      {
        label: 'Duplicate',
        icon: <DuplicateIcon />,
        onClick: () => {
          CustomEditor.duplicateTableColumn(editor, tableBlockId, colIndex);
          handleClose();
        },
      },
      {
        label: 'Clear contents',
        icon: <ClearContentsIcon />,
        onClick: () => {
          CustomEditor.clearTableColumnContent(editor, tableBlockId, colIndex);
          handleClose();
        },
      },
      {
        label: 'Delete',
        icon: <DeleteIcon />,
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
            action.divider ? <MenuDivider key={i} /> : <MenuItem key={i} action={action} />,
          )}
        </div>
      </Popover>
    </>
  );
}
