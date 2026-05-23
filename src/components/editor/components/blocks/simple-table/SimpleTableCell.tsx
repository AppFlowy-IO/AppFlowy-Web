import { Children, forwardRef, useCallback, useMemo } from 'react';

import { BlockType, YjsEditorKey } from '@/application/types';
import { DEFAULT_COLUMN_WIDTH, MIN_WIDTH } from '@/components/editor/components/blocks/simple-table/const';
import { EditorElementProps, SimpleTableCellBlockNode } from '@/components/editor/editor.type';
import { renderColor } from '@/utils/color';

import { SimpleTableColumnResizer } from './SimpleTableColumnResizer';
import { useSimpleTableContext } from './SimpleTableContext';
import { getSlateNodeType } from './simple-table.utils';

const SimpleTableCell = forwardRef<HTMLTableCellElement, EditorElementProps<SimpleTableCellBlockNode>>(
  ({ node, children, ...attributes }, ref) => {
    const { blockId } = node;
    const context = useSimpleTableContext();
    const readOnly = context?.readOnly ?? true;
    const cellPosition = context?.cellPositionById.get(blockId);
    const rowIndex = cellPosition?.row ?? 0;
    const colIndex = cellPosition?.col ?? 0;

    // Read styling from context (always up-to-date)
    const tableData = context?.tableNode?.data;

    const renderedChildren = useMemo(
      () =>
        Children.toArray(children).filter((_, index) => {
          const child = node.children[index];
          const childType = getSlateNodeType(child);

          return childType !== YjsEditorKey.text && childType !== BlockType.SimpleTableRowBlock;
        }),
      [children, node.children]
    );

    const horizontalAlign = tableData?.column_aligns?.[colIndex];
    const bgColor = tableData?.column_colors?.[colIndex];
    const width = tableData?.column_widths?.[colIndex] || DEFAULT_COLUMN_WIDTH;

    // Report hover state to parent context
    const handleMouseEnter = useCallback(() => {
      context?.setHoveringCell({ row: rowIndex, col: colIndex });
    }, [context, rowIndex, colIndex]);

    return (
      <td
        data-block-type={node.type}
        data-block-cell={blockId}
        data-cell-index={colIndex}
        data-row-index={rowIndex}
        ref={ref}
        {...attributes}
        rowSpan={1}
        colSpan={1}
        data-table-cell-horizontal-align={horizontalAlign?.toLowerCase()}
        onMouseEnter={handleMouseEnter}
        style={{
          ...attributes.style,
          backgroundColor: bgColor ? renderColor(bgColor) : undefined,
          minWidth: width ? `${width}px` : undefined,
          width: width ? `${width}px` : undefined,
          position: 'relative',
        }}
      >
        <div className={'cell-children'}>{renderedChildren}</div>
        {!readOnly && <SimpleTableColumnResizer colIndex={colIndex} initialWidth={width || MIN_WIDTH} />}
      </td>
    );
  }
);

export default SimpleTableCell;
