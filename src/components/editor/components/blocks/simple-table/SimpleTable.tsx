import isEqual from 'lodash-es/isEqual';
import { Children, forwardRef, memo, useCallback, useMemo, useState } from 'react';
import { useReadOnly } from 'slate-react';

import { BlockType } from '@/application/types';
import { useSimpleTable } from '@/components/editor/components/blocks/simple-table/SimpleTable.hooks';
import { SimpleTableActionButtons } from '@/components/editor/components/blocks/simple-table/SimpleTableActionButtons';
import { SimpleTableActionOverlay } from '@/components/editor/components/blocks/simple-table/SimpleTableActionOverlay';
import {
  SimpleTableContext,
  SimpleTableContextValue,
} from '@/components/editor/components/blocks/simple-table/SimpleTableContext';
import { EditorElementProps, SimpleTableNode, SimpleTableRowNode } from '@/components/editor/editor.type';

import './simple-table.scss';
import { DEFAULT_COLUMN_WIDTH } from '@/components/editor/components/blocks/simple-table/const';

import { getSlateNodeType, isSimpleTableCellNode, isSimpleTableRowNode } from './simple-table.utils';

const SimpleTable = memo(
  forwardRef<HTMLDivElement, EditorElementProps<SimpleTableNode>>(
    ({ node, children, className: classNameProp, ...attributes }, ref) => {
      const readOnly = useReadOnly();
      const { data, children: rows } = node;
      const { column_widths, column_colors, enable_header_column, enable_header_row } = data;

      const [isHoveringTable, setIsHoveringTable] = useState(false);
      const [hoveringCell, setHoveringCell] = useState<{ row: number; col: number } | null>(null);
      const [isMenuOpen, setIsMenuOpen] = useState(false);

      const rowNodes = useMemo(() => rows.filter(isSimpleTableRowNode), [rows]);
      const renderedRows = useMemo(
        () =>
          Children.toArray(children).filter(
            (_, index) => getSlateNodeType(rows[index]) === BlockType.SimpleTableRowBlock
          ),
        [children, rows]
      );
      const columnCount = useMemo(() => {
        const firstRow = rowNodes[0] as SimpleTableRowNode | undefined;

        if (!firstRow) return 0;

        return firstRow.children.filter(isSimpleTableCellNode).length;
      }, [rowNodes]);
      const cellPositionById = useMemo(() => {
        const positions = new Map<string, { row: number; col: number }>();

        rowNodes.forEach((row, rowIndex) => {
          let colIndex = 0;

          row.children.forEach((child) => {
            if (!isSimpleTableCellNode(child)) return;

            positions.set(child.blockId, { row: rowIndex, col: colIndex });
            colIndex += 1;
          });
        });

        return positions;
      }, [rowNodes]);

      const columns = useMemo(() => {
        return Array.from({ length: columnCount }, (_, index) => {
          const width = column_widths?.[index] || DEFAULT_COLUMN_WIDTH;
          const bgColor = column_colors?.[index] || 'transparent';

          return { width, bgColor };
        });
      }, [columnCount, column_colors, column_widths]);
      const tableWidth = useMemo(() => {
        return columns.reduce((sum, column) => sum + column.width, 0);
      }, [columns]);
      const colGroup = useMemo(() => {
        if (!columns) return null;
        return (
          <colgroup>
            {columns.map((column, index) => (
              <col key={index} style={{ width: `${column.width}px` }} />
            ))}
          </colgroup>
        );
      }, [columns]);
      const { isIntersection } = useSimpleTable(node);

      const className = useMemo(() => {
        const classList = ['simple-table', 'appflowy-scroller'];

        if (classNameProp) {
          classList.push(classNameProp);
        }

        if (enable_header_column) {
          classList.push('enable-header-column');
        }

        if (enable_header_row) {
          classList.push('enable-header-row');
        }

        if (isIntersection) {
          classList.push('selected');
        }

        return classList.join(' ');
      }, [classNameProp, enable_header_column, enable_header_row, isIntersection]);

      const handleMouseEnter = useCallback(() => {
        setIsHoveringTable(true);
      }, []);

      const handleMouseLeave = useCallback(() => {
        if (isMenuOpen) return; // Don't clear hover state while context menu is open
        setIsHoveringTable(false);
        setHoveringCell(null);
      }, [isMenuOpen]);

      const contextValue = useMemo<SimpleTableContextValue>(
        () => ({
          tableNode: node,
          cellPositionById,
          rowCount: rowNodes.length,
          columnCount,
          isHoveringTable,
          hoveringCell,
          readOnly,
          setHoveringCell,
          isMenuOpen,
          setIsMenuOpen,
        }),
        [node, cellPositionById, rowNodes.length, columnCount, isHoveringTable, hoveringCell, readOnly, isMenuOpen]
      );

      return (
        <div
          ref={ref}
          {...attributes}
          className={className}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <SimpleTableContext.Provider value={contextValue}>
            <div className='simple-table-root-wrapper'>
              <div className='simple-table-scroll-container'>
                <table style={tableWidth ? { width: `${tableWidth}px` } : undefined}>
                  {colGroup}
                  <tbody>{renderedRows}</tbody>
                </table>
              </div>
              <SimpleTableActionOverlay />
              <SimpleTableActionButtons />
            </div>
          </SimpleTableContext.Provider>
        </div>
      );
    }
  ),
  (prevProps, nextProps) => isEqual(prevProps.node, nextProps.node)
);

export default SimpleTable;
