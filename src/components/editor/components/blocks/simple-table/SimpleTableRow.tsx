import { forwardRef } from 'react';
import { ReactEditor, useSlate } from 'slate-react';

import { EditorElementProps, SimpleTableRowNode } from '@/components/editor/editor.type';
import { renderColor } from '@/utils/color';

import { useSimpleTableContext } from './SimpleTableContext';

const SimpleTableRow =
  forwardRef<HTMLTableRowElement, EditorElementProps<SimpleTableRowNode>>(({
      node,
      children,
      ...attributes
    }, ref) => {
      const { blockId } = node;
      const context = useSimpleTableContext();
      const editor = useSlate();
      const path = ReactEditor.findPath(editor, node);

      // Use the Slate path's last element as the row index — always current
      const index = path[path.length - 1];

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
          {children}
        </tr>
      );
    },
  );

export default SimpleTableRow;