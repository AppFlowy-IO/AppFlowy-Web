import { forwardRef, useCallback, useMemo } from 'react';
import { Editor, Element, NodeEntry } from 'slate';
import { useSlate } from 'slate-react';

import { BlockType } from '@/application/types';
import { DEFAULT_COLUMN_WIDTH, MIN_WIDTH } from '@/components/editor/components/blocks/simple-table/const';
import { EditorElementProps, SimpleTableCellBlockNode, SimpleTableNode } from '@/components/editor/editor.type';
import { renderColor } from '@/utils/color';

import { SimpleTableColumnResizer } from './SimpleTableColumnResizer';
import { useSimpleTableContext } from './SimpleTableContext';

const SimpleTableCell =
  forwardRef<HTMLTableCellElement, EditorElementProps<SimpleTableCellBlockNode>>(({
      node,
      children,
      ...attributes
    }, ref) => {
      const { blockId } = node;
      const editor = useSlate();
      const context = useSimpleTableContext();
      const readOnly = context?.readOnly ?? true;

      const path = useMemo(() => {
        try {
          const entries = Editor.nodes(editor, {
            at: [],
            match: (n) => !Editor.isEditor(n) && Element.isElement(n) && (n as Element & { blockId?: string }).blockId === blockId,
          });

          for (const [, p] of entries) {
            return p;
          }
        } catch {
          // fallback
        }

        return undefined;
      }, [editor, blockId]);

      const table = useMemo(() => {
        if (!path) return null;

        const match = Editor.above(editor, {
          match: (n) => {
            return !Editor.isEditor(n) && Element.isElement(n) && n.type === BlockType.SimpleTableBlock;
          },
          at: path,
        });

        if (!match) return null;

        return match as NodeEntry<Element>;
      }, [editor, path]);

      const row = useMemo(() => {
        if (!path) return null;

        const match = Editor.above(editor, {
          match: (n) => {
            return !Editor.isEditor(n) && Element.isElement(n) && n.type === BlockType.SimpleTableRowBlock;
          },
          at: path,
        });

        if (!match) return null;

        return match as NodeEntry<Element>;
      }, [editor, path]);

      const { rowIndex, colIndex } = useMemo(() => {
        if (!row || !table || !path) return { rowIndex: 0, colIndex: 0 };

        const [, rowPath] = row;
        const colIndex = path[path.length - 1];
        const rowIndex = rowPath[rowPath.length - 1];

        return { rowIndex, colIndex };
      }, [row, table, path]);

      const { horizontalAlign, bgColor, width } = useMemo(() => {
        if (!table || !row) return {
          bgColor: undefined,
          horizontalAlign: undefined,
          width: undefined,
        };

        const [parentElement] = table;

        const horizontalAlign = (parentElement as SimpleTableNode).data.column_aligns?.[colIndex];
        const bgColor = (parentElement as SimpleTableNode).data.column_colors?.[colIndex];

        const width = (parentElement as SimpleTableNode).data.column_widths?.[colIndex] || DEFAULT_COLUMN_WIDTH;

        return {
          horizontalAlign,
          bgColor,
          width,
        };
      }, [colIndex, row, table]);

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
          <div
            className={'cell-children'}
          >
            {children}
          </div>
          {!readOnly && (
            <SimpleTableColumnResizer
              colIndex={colIndex}
              initialWidth={width || MIN_WIDTH}
            />
          )}
        </td>
      );
    },
  );

export default SimpleTableCell;
