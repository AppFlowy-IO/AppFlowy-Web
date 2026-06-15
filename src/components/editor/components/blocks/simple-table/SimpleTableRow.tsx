import { Children, forwardRef, useMemo } from 'react';
import { ReactEditor, useSlate } from 'slate-react';

import { BlockType } from '@/application/types';
import { EditorElementProps, SimpleTableRowNode } from '@/components/editor/editor.type';
import { renderColor } from '@/utils/color';

import { useSimpleTableContext } from './SimpleTableContext';
import { getSlateNodeType, isSimpleTableRowNode } from './simple-table.utils';

const SimpleTableRow = forwardRef<HTMLTableRowElement, EditorElementProps<SimpleTableRowNode>>(
  ({ node, children, ...attributes }, ref) => {
    const { blockId } = node;
    const context = useSimpleTableContext();
    const editor = useSlate();
    const path = ReactEditor.findPath(editor, node);
    const renderedCells = useMemo(
      () =>
        Children.toArray(children).filter(
          (_, index) => getSlateNodeType(node.children[index]) === BlockType.SimpleTableCellBlock
        ),
      [children, node.children]
    );
    const tableRows = useMemo(
      () => context?.tableNode.children.filter(isSimpleTableRowNode) ?? [],
      [context?.tableNode.children]
    );
    const tableRowIndex = tableRows.findIndex((row) => row.blockId === blockId);

    // Prefer the semantic table row index; pasted tables may have a hidden
    // Slate text child before the first row while the view is updating.
    const index = tableRowIndex >= 0 ? tableRowIndex : path[path.length - 1];

    const tableData = context?.tableNode?.data;
    const align = tableData?.row_aligns?.[index];
    const bgColor = tableData?.row_colors?.[index];

    return (
      <tr
        data-row-index={index}
        data-block-type={node.type}
        ref={ref}
        {...attributes}
        data-table-row={blockId}
        data-table-row-horizontal-align={align?.toLowerCase()}
        style={{
          ...attributes.style,
          backgroundColor: bgColor ? renderColor(bgColor) : undefined,
        }}
      >
        {renderedCells}
      </tr>
    );
  }
);

export default SimpleTableRow;
