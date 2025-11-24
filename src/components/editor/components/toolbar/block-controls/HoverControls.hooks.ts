import { useCallback, useEffect, useRef, useState } from 'react';
import { Editor, Element, Range, Path } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { getScrollParent } from '@/components/global-comment/utils';

import { findEventNode, getBlockActionsPosition, getBlockCssProperty } from './utils';

export function useHoverControls({ disabled }: { disabled: boolean }) {
  const editor = useSlateStatic() as YjsEditor;
  const ref = useRef<HTMLDivElement>(null);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [hoveredBlockParentId, setHoveredBlockParentId] = useState<string | null>(null);
  const [cssProperty, setCssProperty] = useState<string>('');

  const recalculatePosition = useCallback(
    (blockElement: HTMLElement) => {
      const { top, left } = getBlockActionsPosition(editor, blockElement);

      const slateEditorDom = ReactEditor.toDOMNode(editor, editor);

      if (!ref.current) return;

      ref.current.style.top = `${top + slateEditorDom.offsetTop}px`;
      ref.current.style.left = `${left + slateEditorDom.offsetLeft - 64}px`;
    },
    [editor]
  );

  const close = useCallback(() => {
    const el = ref.current;

    if (!el) return;

    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    setHoveredBlockId(null);
    setHoveredBlockParentId(null);
    setCssProperty('');
  }, [ref]);

  const updateParentId = useCallback((blockId: string | null) => {
    if (!blockId) {
      setHoveredBlockParentId(null);
      return;
    }

    try {
      const entry = findSlateEntryByBlockId(editor, blockId);

      if (!entry) {
        setHoveredBlockParentId(null);
        return;
      }

      const [, path] = entry;

      if (!path || path.length === 0) {
        setHoveredBlockParentId(null);
        return;
      }

      const parentPath = Path.parent(path);
      const parentEntry = Editor.node(editor, parentPath);

      if (Element.isElement(parentEntry[0]) && parentEntry[0].blockId) {
        setHoveredBlockParentId(parentEntry[0].blockId);
      } else {
        setHoveredBlockParentId(null);
      }
    } catch {
      setHoveredBlockParentId(null);
    }
  }, [editor]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (disabled) return;
      const el = ref.current;

      if (!el) return;

      let range: Range | null = null;
      let node: Element | null = null;

      try {
        range = ReactEditor.findEventRange(editor, e);
        if (!range) {
          throw new Error('No range found');
        }
      } catch {
        const newX = e.clientX + 64;

        node = findEventNode(editor, {
          x: newX,
          y: e.clientY,
        });
      }

      if (!range && !node) {
        console.warn('No range and node found');
        return;
      } else if (range) {
        try {
          const match = editor.above({
            match: (n) => {
              return !Editor.isEditor(n) && Element.isElement(n) && n.blockId !== undefined;
            },
            at: range,
          });

          if (!match) {
            close();
            return;
          }

          node = match[0];
        } catch {
          // do nothing
        }
      }

      if (!node) {
        close();
        return;
      }

      const blockElement = ReactEditor.toDOMNode(editor, node);

      if (!blockElement) return;
      const shouldSkipParentTypes = [BlockType.TableBlock, BlockType.SimpleTableBlock];

      if (shouldSkipParentTypes.some((type) => blockElement.closest(`[data-block-type="${type}"]`))) {
        close();
        return;
      } else {
        recalculatePosition(blockElement);
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';

        setCssProperty(getBlockCssProperty(node));
        setHoveredBlockId(node.blockId as string);
        updateParentId(node.blockId as string);
      }
    };

    const dom = ReactEditor.toDOMNode(editor, editor);

    if (!disabled) {
      dom.addEventListener('mousemove', handleMouseMove);
      dom.parentElement?.addEventListener('mouseleave', close);
      getScrollParent(dom)?.addEventListener('scroll', close);

      // Check if the hovered block still exists (e.g. after a drag-and-drop operation where the ID changed)
      if (hoveredBlockId) {
        try {
          const entry = findSlateEntryByBlockId(editor, hoveredBlockId);

          if (!entry) {
            close();
          }
        } catch {
          close();
        }
      }
    }

    return () => {
      dom.removeEventListener('mousemove', handleMouseMove);
      dom.parentElement?.removeEventListener('mouseleave', close);
      getScrollParent(dom)?.removeEventListener('scroll', close);
    };
  }, [close, editor, ref, recalculatePosition, disabled, updateParentId, hoveredBlockId]);

  useEffect(() => {
    let observer: MutationObserver | null = null;

    if (hoveredBlockId) {
      try {
        const entry = findSlateEntryByBlockId(editor, hoveredBlockId);

        if (!entry) return;
        const [node] = entry;

        if (!node) return;

        const dom = ReactEditor.toDOMNode(editor, node);

        if (dom.parentElement) {
          observer = new MutationObserver(() => {
            if (!disabled) {
              close();
            }
          });

          observer.observe(dom.parentElement, {
            childList: true,
          });
        }
      } catch (e) {
        console.error(e);
      }
    }

    return () => {
      observer?.disconnect();
    };
  }, [close, editor, hoveredBlockId, disabled]);

  return {
    hoveredBlockId,
    hoveredBlockParentId,
    ref,
    cssProperty,
  };
}
