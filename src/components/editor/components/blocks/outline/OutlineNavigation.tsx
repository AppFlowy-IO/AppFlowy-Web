import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Editor, Element, Transforms } from 'slate';
import { ReactEditor, useSlateSelector, useSlateStatic } from 'slate-react';

import { HEADER_HEIGHT } from '@/application/constants';
import { BlockType } from '@/application/types';
import { HeadingNode, OutlineNode, ToggleListNode } from '@/components/editor/editor.type';
import { useEditorPreviewId } from '@/components/editor/EditorPreviewContext';
import { ColorEnum } from '@/utils/color';

import { extractHeadings, getActiveHeading } from './utils';

function containsDocumentBlock(node: Node) {
  return (
    node instanceof HTMLElement &&
    (node.hasAttribute('data-block-type') || node.querySelector('[data-block-type]') !== null)
  );
}

function selectOutline(editor: Editor, dockable: boolean) {
  // The first inline outline supplies the document theme; its depth and collapsed state stay independent.
  const outline = Editor.nodes<OutlineNode>(editor, {
    at: [],
    match: (node) => Element.isElement(node) && node.type === BlockType.OutlineBlock,
  }).next().value?.[0];
  // Preview and nested editors need heading labels only if they contain an inline outline.
  const { headings, hasHeadings } =
    dockable || outline ? extractHeadings(editor, 6) : { headings: [], hasHeadings: false };

  return { headings, hasHeadings, hasOutline: !!outline, color: (outline?.data?.bgColor || '') as ColorEnum };
}

function equalHeadings(
  a: ReturnType<typeof selectOutline>['headings'],
  b: ReturnType<typeof selectOutline>['headings']
) {
  return (
    a.length === b.length &&
    a.every((heading, index) => {
      const other = b[index];

      return (
        heading.blockId === other.blockId &&
        heading.data.level === other.data.level &&
        heading.data.text === other.data.text
      );
    })
  );
}

function equalOutline(a: ReturnType<typeof selectOutline>, b: ReturnType<typeof selectOutline>) {
  return (
    a.color === b.color &&
    a.hasOutline === b.hasOutline &&
    a.hasHeadings === b.hasHeadings &&
    equalHeadings(a.headings, b.headings)
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
  const [mentionVersion, setMentionVersion] = useState(0);
  const cache = useRef<{
    children: Editor['children'];
    version: number;
    mentionVersion: number;
    dockable: boolean;
    result: ReturnType<typeof selectOutline>;
  }>();
  const selector = useCallback(
    (editor: Editor) => {
      // Cursor movement does not change children; avoid rescanning the document.
      if (
        cache.current?.children === editor.children &&
        cache.current.version === contentVersion &&
        cache.current.mentionVersion === mentionVersion &&
        cache.current.dockable === dockable
      )
        return cache.current.result;
      const next = selectOutline(editor, dockable);
      const previous = cache.current?.result;
      const result = previous && equalOutline(previous, next) ? previous : next;

      // Theme changes do not change the heading list or its scroll targets.
      if (previous && result !== previous && equalHeadings(previous.headings, result.headings)) {
        result.headings = previous.headings;
      }

      cache.current = { children: editor.children, version: contentVersion, mentionVersion, dockable, result };
      return result;
    },
    [contentVersion, mentionVersion, dockable]
  );
  const outline = useSlateSelector(selector, equalOutline);
  const trackingEnabled = outline.hasHeadings && (outline.hasOutline || (dockable && outline.headings.length > 2));
  const headingsRef = useRef(outline.headings);
  const scheduleScrollspyRef = useRef<() => void>();
  const [activeId, setActiveId] = useState<string>();
  const jumpFrame = useRef(0);
  const navigating = useRef(false);
  const navigationTimer = useRef<ReturnType<typeof setTimeout>>();
  const finishNavigation = useCallback(() => {
    clearTimeout(navigationTimer.current);
    navigating.current = false;
  }, []);
  const deferScrollspy = useCallback(() => {
    clearTimeout(navigationTimer.current);
    navigating.current = true;
    // A click remains selected after scrolling settles, even when the anchor
    // cannot reach the reading line at the end of a short document.
    navigationTimer.current = setTimeout(finishNavigation, 150);
  }, [finishNavigation]);

  useEffect(
    () => () => {
      cancelAnimationFrame(jumpFrame.current);
      finishNavigation();
    },
    [finishNavigation]
  );
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
    // Keep long-lived scroll subscriptions current without resetting click navigation on a text edit.
    const previous = headingsRef.current;

    headingsRef.current = outline.headings;
    if (
      previous.length !== outline.headings.length ||
      previous.some((heading, index) => heading.blockId !== outline.headings[index].blockId)
    )
      scheduleScrollspyRef.current?.();
  }, [outline.headings]);

  useEffect(() => {
    if (!trackingEnabled) return;
    const root = getEditorElement();

    if (!root) return;
    let frame = 0;
    const refresh = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setMentionVersion((version) => version + 1);
      });
    };

    // Page names and icons resolve independently of Slate operations. Reuse
    // their rendered labels, as the inline Outline Block does, after DOM commit.
    const observer = new MutationObserver((records) => {
      // A block move can preserve heading order and total editor height. Observe
      // committed block additions/removals so it still triggers a position measurement.
      if (
        records.some(
          ({ addedNodes, removedNodes }) =>
            Array.from(addedNodes).some(containsDocumentBlock) || Array.from(removedNodes).some(containsDocumentBlock)
        )
      )
        scheduleScrollspyRef.current?.();
      if (
        records.some(({ target, addedNodes }) => {
          const element = target instanceof HTMLElement ? target : target.parentElement;

          return (
            element?.closest('.heading, .toggle-heading') &&
            (element.closest('[data-mention-id]') ||
              Array.from(addedNodes).some(
                (node) =>
                  node instanceof HTMLElement &&
                  (node.matches('[data-mention-id]') || node.querySelector('[data-mention-id]'))
              ))
          );
        })
      )
        refresh();
    });

    observer.observe(root, { subtree: true, childList: true, characterData: true });
    refresh();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [trackingEnabled, getEditorElement]);

  useEffect(() => {
    if (!trackingEnabled) return;
    const root = getEditorElement();

    if (!root) return;
    const scroller = root.closest<HTMLElement>('.appflowy-scroll-container') ?? window;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (navigating.current) return;
      const top = scroller instanceof HTMLElement ? scroller.getBoundingClientRect().top : 0;
      const positions = headingsRef.current.flatMap((heading) => {
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

    scheduleScrollspyRef.current = schedule;
    const onScroll = () => {
      if (navigating.current) deferScrollspy();
      else schedule();
    };

    const onKeyDown = (event: Event) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes((event as KeyboardEvent).key))
        finishNavigation();
    };

    const resizeObserver = new ResizeObserver(schedule);

    resizeObserver.observe(root);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('wheel', finishNavigation, { passive: true });
    scroller.addEventListener('touchmove', finishNavigation, { passive: true });
    scroller.addEventListener('pointerdown', finishNavigation, { passive: true });
    scroller.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      scheduleScrollspyRef.current = undefined;
      cancelAnimationFrame(frame);
      finishNavigation();
      resizeObserver.disconnect();
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('wheel', finishNavigation);
      scroller.removeEventListener('touchmove', finishNavigation);
      scroller.removeEventListener('pointerdown', finishNavigation);
      scroller.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', schedule);
    };
  }, [trackingEnabled, getEditorElement, getHeadingElement, deferScrollspy, finishNavigation]);

  const jumpToHeading = useCallback(
    (heading: HeadingNode) => {
      const element = getHeadingElement(heading.blockId);

      if (!element) return;
      deferScrollspy();
      setActiveId(heading.blockId);
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
    [editor, getHeadingElement, deferScrollspy]
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
