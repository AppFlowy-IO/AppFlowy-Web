import React, { useCallback, useEffect, useState } from 'react';
import { Editor, Range, Text } from 'slate';
import { ReactEditor } from 'slate-react';

import { useRemoteSelectionsSelector } from '@/application/awareness';
import { useEditorContext } from '@/components/editor/EditorContext';
import { cn } from '@/lib/utils';
import { renderColor } from '@/utils/color';


interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RemoteSelectionPosition {
  uid: number;
  deviceId: string;
  name: string;
  cursorColor: string;
  selectionColor: string;
  isCollapsed: boolean;
  selectionRects: SelectionRect[];
  anchorPosition: { x: number; y: number; height: number };
}

interface RemoteSelectionsLayerProps {
  editor: Editor;
}

export const RemoteSelectionsLayer: React.FC<RemoteSelectionsLayerProps> = ({ editor }) => {
  const { awareness } = useEditorContext();
  const remoteSelections = useRemoteSelectionsSelector(awareness);

  const [selectionPositions, setSelectionPositions] = useState<RemoteSelectionPosition[]>([]);

  const calculateSelectionPositions = useCallback((): RemoteSelectionPosition[] => {
    if (!editor) {
      return [];
    }

    const positions: RemoteSelectionPosition[] = [];

    for (const selection of remoteSelections) {
      if (!selection.baseRange?.anchor || !selection.baseRange?.focus) {
        continue;
      }

      try {
        const { anchor, focus } = selection.baseRange;

        // Validate if the path exists
        if (!Editor.hasPath(editor, anchor.path) || !Editor.hasPath(editor, focus.path)) {
          console.warn(`Invalid path for selection ${selection.name}:`, { anchor: anchor.path, focus: focus.path });
          continue;
        }

        // Validate if the offset is valid
        const [anchorNode] = editor.node(anchor.path);
        const [focusNode] = editor.node(focus.path);

        const anchorNodeText = Text.isText(anchorNode) ? anchorNode.text : editor.string(anchor.path);
        const focusNodeText = Text.isText(focusNode) ? focusNode.text : editor.string(focus.path);

        if (anchor.offset > anchorNodeText.length || focus.offset > focusNodeText.length) {
          console.warn(`Invalid offset for selection ${selection.name}:`, {
            anchor: { offset: anchor.offset, maxLength: anchorNodeText.length },
            focus: { offset: focus.offset, maxLength: focusNodeText.length },
          });
          continue;
        }

        // Determine if it's a collapsed selection (cursor)
        const isCollapsed = Range.isCollapsed(selection.baseRange);

        // Calculate the starting position of the selection (anchor)
        const anchorDomPoint = ReactEditor.toDOMPoint(editor, anchor);
        const anchorRange = document.createRange();

        anchorRange.setStart(anchorDomPoint[0], anchorDomPoint[1]);
        anchorRange.collapse(true);

        const anchorRect = anchorRange.getBoundingClientRect();
        const editorElement = ReactEditor.toDOMNode(editor, editor);
        const editorRect = editorElement.getBoundingClientRect();

        const anchorPosition = {
          x: anchorRect.left - editorRect.left,
          y: anchorRect.top - editorRect.top,
          height: anchorRect.height,
        };

        // Check if cursor is inside a scroll container (e.g., table) and
        // skip if it's scrolled out of the visible area
        const anchorDomNode = anchorDomPoint[0].parentElement;
        const scrollParent = anchorDomNode?.closest('.simple-table-scroll-container');

        if (scrollParent) {
          const scrollRect = scrollParent.getBoundingClientRect();

          // If the cursor is outside the scroll container's visible bounds, skip it
          if (
            anchorRect.left < scrollRect.left - 10 ||
            anchorRect.right > scrollRect.right + 10 ||
            anchorRect.top < scrollRect.top - 10 ||
            anchorRect.bottom > scrollRect.bottom + 10
          ) {
            continue;
          }
        }

        // Get the background rectangles of the selection (only needed when not collapsed)
        let selectionRects: SelectionRect[] = [];

        if (!isCollapsed) {
          const slateRange = { anchor, focus };
          const domRange = ReactEditor.toDOMRange(editor, slateRange);
          // filter out single line selections (we need to show the actual text range, not the full line width)
          const clientRects = Array.from(domRange.getClientRects()).filter((rect) => rect.height !== 24);

          selectionRects = clientRects.map((rect) => ({
            x: rect.left - editorRect.left,
            y: rect.top - editorRect.top,
            width: rect.width,
            height: rect.height,
          }));
        }

        // Check if it's within the viewport
        const isInViewport = anchorPosition.y > -100 && anchorPosition.y < editorRect.height + 100;

        if (isInViewport) {
          positions.push({
            uid: selection.uid,
            name: selection.name,
            deviceId: selection.deviceId,
            cursorColor: selection.cursorColor,
            selectionColor: selection.selectionColor,
            isCollapsed,
            selectionRects,
            anchorPosition,
          });
        }
      } catch (error) {
        console.warn(`Failed to calculate position for selection ${selection.name}:`, error);
        continue;
      }
    }

    return positions;
  }, [remoteSelections, editor]);

  useEffect(() => {
    try {
      const positions = calculateSelectionPositions();

      setSelectionPositions(positions);
    } catch (error) {
      console.error('Selection position calculation failed:', error);
      setSelectionPositions([]);
    }
  }, [calculateSelectionPositions]);

  return (
    <>
      {selectionPositions.map((selection) => (
        <RemoteSelectionRenderer key={`${selection.uid}-${selection.deviceId}`} {...selection} />
      ))}
    </>
  );
};

const RemoteSelectionRenderer: React.FC<RemoteSelectionPosition> = ({
  uid,
  name,
  cursorColor,
  selectionColor,
  isCollapsed,
  selectionRects,
  anchorPosition,
}) => {
  return (
    <>
      {/* Range */}
      {!isCollapsed &&
        selectionRects.map((rect, index) => (
          <div
            key={`selection-${uid}-${index}`}
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              backgroundColor: renderColor(selectionColor),
            }}
          />
        ))}

      {/* Cursor */}
      {isCollapsed && (
        <div
          className={cn('animate-blink')}
          style={{
            position: 'absolute',
            left: anchorPosition.x - 1,
            top: anchorPosition.y,
            width: '2px',
            height: anchorPosition.height,
            backgroundColor: renderColor(cursorColor),
            borderRadius: '1px',
            zIndex: 3,
          }}
        />
      )}

      {/* User card */}
      <div
        style={{
          position: 'absolute',
          left: anchorPosition.x,
          top: anchorPosition.y - 25,
          backgroundColor: renderColor(cursorColor),
          color: 'var(--text-text-primary)',
          padding: '3px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: '500',
          whiteSpace: 'nowrap',
          transform: 'translateX(0)',
          zIndex: 3,
        }}
      >
        {name}
      </div>
    </>
  );
};
