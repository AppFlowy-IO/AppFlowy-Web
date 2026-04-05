import isEqual from 'lodash-es/isEqual';
import { forwardRef, memo, useCallback, useMemo, useState } from 'react';
import { useReadOnly } from 'slate-react';

import { useSimpleTable } from '@/components/editor/components/blocks/simple-table/SimpleTable.hooks';
import { SimpleTableActionButtons } from '@/components/editor/components/blocks/simple-table/SimpleTableActionButtons';
import { SimpleTableActionOverlay } from '@/components/editor/components/blocks/simple-table/SimpleTableActionOverlay';
import { SimpleTableContext, SimpleTableContextValue } from '@/components/editor/components/blocks/simple-table/SimpleTableContext';
import { EditorElementProps, SimpleTableNode, SimpleTableRowNode } from '@/components/editor/editor.type';

import './simple-table.scss';
import { DEFAULT_COLUMN_WIDTH } from '@/components/editor/components/blocks/simple-table/const';

const SimpleTable = memo(
  forwardRef<HTMLDivElement, EditorElementProps<SimpleTableNode>>(({
    node,
    children,
    className: classNameProp,
    ...attributes
  }, ref) => {
    const readOnly = useReadOnly();
    const { data, children: rows } = node;
    const { column_widths, column_colors, enable_header_column, enable_header_row } = data;

    const [isHoveringTable, setIsHoveringTable] = useState(false);
    const [hoveringCell, setHoveringCell] = useState<{ row: number; col: number } | null>(null);

    const columnCount = useMemo(() => {
      const firstRow = rows[0] as SimpleTableRowNode;

      if (!firstRow) return 0;

      return firstRow.children.length;
    }, [rows]);

    const columns = useMemo(() => {
      return Array.from({ length: columnCount }, (_, index) => {
        const width = column_widths?.[index] || DEFAULT_COLUMN_WIDTH;
        const bgColor = column_colors?.[index] || 'transparent';

        return { width, bgColor };
      });
    }, [columnCount, column_colors, column_widths]);
    const colGroup = useMemo(() => {
      if (!columns) return null;
      return <colgroup>
        {columns.map((column, index) => (
          <col
            key={index}
            style={{ width: `${column.width}px` }}
          />
        ))}
      </colgroup>;
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
      setIsHoveringTable(false);
      setHoveringCell(null);
    }, []);

    const contextValue = useMemo<SimpleTableContextValue>(() => ({
      tableNode: node,
      isHoveringTable,
      hoveringCell,
      readOnly,
      setHoveringCell,
    }), [node, isHoveringTable, hoveringCell, readOnly]);

    return (
      <div
        ref={ref}
        {...attributes}
        className={className}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <SimpleTableContext.Provider value={contextValue}>
          <div className="simple-table-root-wrapper">
            <div className="simple-table-scroll-container">
              <table>
                {colGroup}
                <tbody>
                {children}
                </tbody>
              </table>
            </div>
            <SimpleTableActionOverlay />
            <SimpleTableActionButtons />
          </div>
        </SimpleTableContext.Provider>
      </div>
    );
  }),
  (prevProps, nextProps) => isEqual(prevProps.node, nextProps.node),
);

export default SimpleTable;
