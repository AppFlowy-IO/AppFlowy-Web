import { useEffect, useState } from 'react';
import { Editor, Path, Range } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { SimpleTableNode } from '@/components/editor/editor.type';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

import {
  handleArrowDown,
  handleArrowLeft,
  handleArrowRight,
  handleArrowUp,
  handleShiftTab,
  handleTab,
} from './SimpleTable.keyboard';

export function useSimpleTable(node: SimpleTableNode) {
  const editor = useSlateStatic();
  const [inCurrentTable, setInCurrentTable] = useState(false);
  const [isIntersection, setIsIntersection] = useState(false);

  useEffect(() => {
    const { onChange } = editor;

    editor.onChange = () => {
      onChange();
      const { selection } = editor;

      if (!selection) return;
      const path = ReactEditor.findPath(editor, node);
      const [start, end] = Editor.edges(editor, selection);
      const isAncestor = Path.isAncestor(path, end.path) && Path.isAncestor(path, start.path);
      const isIntersection = !isAncestor && Range.intersection(selection, Editor.range(editor, path));

      setIsIntersection(!!isIntersection);
      setInCurrentTable(isAncestor);
    };

    return () => {
      editor.onChange = onChange;
    };
  }, [editor, node]);

  useEffect(() => {
    const editorDom = ReactEditor.toDOMNode(editor, editor);

    const handleKeydown = (event: KeyboardEvent) => {
      if (!inCurrentTable) return;

      switch (true) {
        case createHotkey(HOT_KEY_NAME.UP)(event): {
          if (handleArrowUp(editor)) {
            event.stopPropagation();
            event.preventDefault();
          }

          break;
        }

        case createHotkey(HOT_KEY_NAME.DOWN)(event): {
          if (handleArrowDown(editor)) {
            event.stopPropagation();
            event.preventDefault();
          }

          break;
        }

        case createHotkey(HOT_KEY_NAME.LEFT)(event): {
          if (handleArrowLeft(editor)) {
            event.stopPropagation();
            event.preventDefault();
          }

          break;
        }

        case createHotkey(HOT_KEY_NAME.RIGHT)(event): {
          if (handleArrowRight(editor)) {
            event.stopPropagation();
            event.preventDefault();
          }

          break;
        }

        case createHotkey(HOT_KEY_NAME.INDENT_BLOCK)(event): {
          // Tab: move to next cell
          if (handleTab(editor)) {
            event.stopPropagation();
            event.preventDefault();
          }

          break;
        }

        case createHotkey(HOT_KEY_NAME.OUTDENT_BLOCK)(event): {
          // Shift+Tab: move to previous cell
          if (handleShiftTab(editor)) {
            event.stopPropagation();
            event.preventDefault();
          }

          break;
        }
      }
    };

    editorDom.addEventListener('keydown', handleKeydown);

    return () => {
      editorDom.removeEventListener('keydown', handleKeydown);
    };
  }, [editor, inCurrentTable]);

  return {
    isIntersection,
  };
}
