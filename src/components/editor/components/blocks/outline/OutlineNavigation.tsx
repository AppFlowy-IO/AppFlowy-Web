import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Editor, Element, Transforms } from 'slate';
import { ReactEditor, useSlateSelector, useSlateStatic } from 'slate-react';

import { HEADER_HEIGHT } from '@/application/constants';
import { BlockType } from '@/application/types';
import { HeadingNode, OutlineNode, ToggleListNode } from '@/components/editor/editor.type';
import { useEditorPreviewId } from '@/components/editor/EditorPreviewContext';
import { ColorEnum } from '@/utils/color';

import { extractHeadings, getActiveHeading } from './utils';

function selectOutline(editor: Editor) {
  const { headings, hasHeadings } = extractHeadings(editor, 6);
  // The first inline outline supplies the document theme; its depth and collapsed state stay independent.
  const outline = Editor.nodes<OutlineNode>(editor, {
    at: [],
    match: (node) => Element.isElement(node) && node.type === BlockType.OutlineBlock,
  }).next().value?.[0];

  return { headings, hasHeadings, hasOutline: !!outline, color: (outline?.data?.bgColor || '') as ColorEnum };
}

function equalOutline(a: ReturnType<typeof selectOutline>, b: ReturnType<typeof selectOutline>) {
  return (
    a.color === b.color &&
    a.hasOutline === b.hasOutline &&
    a.hasHeadings === b.hasHeadings &&
    a.headings.length === b.headings.length &&
    a.headings.every((heading, index) => {
      const other = b.headings[index];

      return (
        heading.blockId === other.blockId &&
        heading.data.level === other.data.level &&
        heading.data.text === other.data.text
      );
    })
  );
}

interface OutlineNavigationValue extends ReturnType<typeof selectOutline> {
  activeId?: string;
  jumpToHeading: (heading: HeadingNode) => void;
  getEditorElement: () => HTMLElement | undefined;
}

const OutlineNavigationContext = createContext<OutlineNavigationValue | null>(null);

export function OutlineNavigationProvider({
  children,
  dockable = false,
  contentVersion = 0,
}: {
  children: ReactNode;
  dockable?: boolean;
  /** withYjs can replace children without emitting an ordinary Slate operation. */
  contentVersion?: number;
}) {
  const editor = useSlateStatic();
  const previewId = useEditorPreviewId();
  const cache = useRef<{ children: Editor['children']; version: number; result: ReturnType<typeof selectOutline> }>();
  const selector = useCallback(
    (editor: Editor) => {
      // Cursor movement does not change children; avoid rescanning the document.
      if (cache.current?.children === editor.children && cache.current.version === contentVersion)
        return cache.current.result;
      const result = selectOutline(editor);

      cache.current = { children: editor.children, version: contentVersion, result };
      return result;
    },
    [contentVersion]
  );
  const outline = useSlateSelector(selector, equalOutline);
  const [activeId, setActiveId] = useState<string>();
  const jumpFrame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(jumpFrame.current), []);
  const getEditorElement = useCallback(() => {
    try {
      return ReactEditor.toDOMNode(editor, editor);
    } catch {
      // Collaborative content and lazy block renderers may not have mounted yet.
      return undefined;
    }
  }, [editor]);
  const getHeadingElement = useCallback(
    (blockId: string) => {
      const root = getEditorElement();
      const id = `${previewId ?? ''}heading-${blockId}`;
      const element = document.getElementById(id);

      if (element && root?.contains(element)) return element;
      // The same document can also be mounted in a preview or a side peek.
      return Array.from(root?.querySelectorAll<HTMLElement>('[id]') ?? []).find(
        (element) => element.id === id || element.id === `heading-${blockId}`
      );
    },
    [getEditorElement, previewId]
  );

  useEffect(() => {
    if ((!dockable && !outline.hasOutline) || !outline.headings.length) return;
    const root = getEditorElement();

    if (!root) return;
    const scroller = root.closest<HTMLElement>('.appflowy-scroll-container') ?? window;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = scroller instanceof HTMLElement ? scroller.getBoundingClientRect().top : 0;
      const positions = outline.headings.flatMap((heading) => {
        const element = getHeadingElement(heading.blockId);

        return element?.getClientRects().length
          ? [{ blockId: heading.blockId, top: element.getBoundingClientRect().top }]
          : [];
      });

      const atBottom =
        scroller instanceof HTMLElement &&
        scroller.scrollHeight > scroller.clientHeight &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;

      setActiveId(getActiveHeading(positions, Math.max(0, top) + HEADER_HEIGHT + 16, atBottom));
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    const resizeObserver = new ResizeObserver(schedule);

    resizeObserver.observe(root);
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [dockable, outline.headings, outline.hasOutline, getEditorElement, getHeadingElement]);

  const jumpToHeading = useCallback(
    (heading: HeadingNode) => {
      const element = getHeadingElement(heading.blockId);

      if (!element) return;
      const entry = Editor.nodes<Element>(editor, {
        at: [],
        match: (node) => Element.isElement(node) && node.blockId === heading.blockId,
      }).next().value;
      let revealed = false;

      if (entry) {
        Editor.withoutNormalizing(editor, () => {
          for (const [node, path] of Editor.levels(editor, { at: entry[1] })) {
            if (path.length === entry[1].length) continue;
            if (!Element.isElement(node) || node.type !== BlockType.ToggleListBlock) continue;
            const toggle = node as ToggleListNode;

            if (!toggle.data?.collapsed) continue;
            Transforms.setNodes<ToggleListNode>(editor, { data: { ...toggle.data, collapsed: false } }, { at: path });
            revealed = true;
          }
        });
      }

      const url = new URL(window.location.href);

      url.searchParams.set('blockId', heading.blockId);
      window.history.replaceState(window.history.state, '', url);
      cancelAnimationFrame(jumpFrame.current);
      const scroll = () =>
        getHeadingElement(heading.blockId)?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });

      // Let React reveal collapsed toggle contents before measuring the anchor.
      if (revealed) jumpFrame.current = requestAnimationFrame(scroll);
      else scroll();
    },
    [editor, getHeadingElement]
  );
  const value = useMemo(
    () => ({ ...outline, activeId, jumpToHeading, getEditorElement }),
    [outline, activeId, jumpToHeading, getEditorElement]
  );

  return <OutlineNavigationContext.Provider value={value}>{children}</OutlineNavigationContext.Provider>;
}

export function useOutlineNavigation() {
  const context = useContext(OutlineNavigationContext);

  if (!context) throw new Error('Outline navigation requires OutlineNavigationProvider');
  return context;
}
