import { Divider } from '@mui/material';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Range } from 'slate';
import { ReactEditor, useFocused, useSlate } from 'slate-react';

import BgColor from '@/components/editor/components/toolbar/selection-toolbar/actions/BgColor';
import Bold from '@/components/editor/components/toolbar/selection-toolbar/actions/Bold';
import Formula from '@/components/editor/components/toolbar/selection-toolbar/actions/Formula';
import Href from '@/components/editor/components/toolbar/selection-toolbar/actions/Href';
import InlineCode from '@/components/editor/components/toolbar/selection-toolbar/actions/InlineCode';
import Italic from '@/components/editor/components/toolbar/selection-toolbar/actions/Italic';
import StrikeThrough from '@/components/editor/components/toolbar/selection-toolbar/actions/StrikeThrough';
import TextColor from '@/components/editor/components/toolbar/selection-toolbar/actions/TextColor';
import Underline from '@/components/editor/components/toolbar/selection-toolbar/actions/Underline';
import { SelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';
import { getRangeRect } from '@/components/editor/components/toolbar/selection-toolbar/utils';

export const RICH_TEXT_CELL_OVERLAY_ATTR = 'data-rich-text-cell-overlay';

const TOOLBAR_GAP = 8;

/**
 * The inline formatting toolbar shown over a text selection in a Text cell:
 * the document toolbar's inline actions (no block types, alignment or AI),
 * portaled so the grid cell's overflow clipping cannot hide it.
 */
export function RichTextCellToolbar() {
  const editor = useSlate();
  const focused = useFocused();
  const ref = useRef<HTMLDivElement | null>(null);
  const [forceShown, setForceShown] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const { selection } = editor;
  const hasSelection = Boolean(selection && Range.isExpanded(selection) && editor.string(selection).length > 0);
  const visible = forceShown || (focused && hasSelection);

  const rePosition = useCallback(() => {
    const rect = getRangeRect();
    const el = ref.current;

    if (!rect || !el) return;

    const height = el.offsetHeight || 32;
    const width = el.offsetWidth || 0;
    const top = rect.top - height - TOOLBAR_GAP < 0 ? rect.bottom + TOOLBAR_GAP : rect.top - height - TOOLBAR_GAP;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));

    setPosition((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
  }, []);

  useLayoutEffect(() => {
    if (!visible || forceShown) return;
    rePosition();
  }, [visible, forceShown, selection, rePosition]);

  useEffect(() => {
    if (!visible) return;

    const onScroll = () => rePosition();

    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [visible, rePosition]);

  const forceShow = useCallback((show: boolean) => {
    setForceShown(show);
  }, []);

  // Color pickers ask the toolbar to refocus the editor once they close,
  // sometimes from a timer that fires after the cell editor has unmounted.
  const disableFocusRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const focusEditor = useCallback(
    (debounce?: number) => {
      const focus = () => {
        if (disableFocusRef.current || !mountedRef.current) return;
        try {
          ReactEditor.focus(editor);
        } catch {
          return;
        }

        setForceShown(false);
      };

      if (debounce === undefined) focus();
      else window.setTimeout(focus, debounce);
    },
    [editor]
  );
  const toggleDisableEditorFocus = useCallback(() => {
    if (disableFocusRef.current) {
      window.setTimeout(() => {
        disableFocusRef.current = false;
      }, 50);
    } else {
      disableFocusRef.current = true;
    }
  }, []);

  const contextValue = useMemo(
    () => ({ visible, forceShow, rePosition, getDecorateState: () => undefined }),
    [visible, forceShow, rePosition]
  );

  return createPortal(
    <SelectionToolbarContext.Provider value={contextValue}>
      <div
        ref={ref}
        {...{ [RICH_TEXT_CELL_OVERLAY_ATTR]: true }}
        data-testid='rich-text-cell-toolbar'
        onMouseDown={(e) => {
          // Keep the editor's selection while a button is pressed.
          e.preventDefault();
          e.stopPropagation();
        }}
        style={{
          top: position?.top ?? -9999,
          left: position?.left ?? -9999,
          opacity: visible && position ? 1 : 0,
          pointerEvents: visible && position ? 'auto' : 'none',
        }}
        className={
          'fixed z-[1400] flex min-h-[32px] w-fit items-center gap-1 rounded-lg bg-[var(--fill-toolbar)] px-2 shadow-lg transition-opacity duration-150'
        }
      >
        {visible && (
          <>
            <Underline />
            <Bold />
            <Italic />
            <StrikeThrough />
            <InlineCode />
            <Formula />
            <Divider className={'my-1.5 bg-line-on-toolbar'} orientation={'vertical'} flexItem={true} />
            <Href />
            <TextColor focusEditor={focusEditor} toggleDisableEditorFocus={toggleDisableEditorFocus} />
            <BgColor focusEditor={focusEditor} toggleDisableEditorFocus={toggleDisableEditorFocus} />
          </>
        )}
      </div>
    </SelectionToolbarContext.Provider>,
    document.body
  );
}

export default RichTextCellToolbar;
