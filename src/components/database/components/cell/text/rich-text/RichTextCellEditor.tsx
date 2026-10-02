import { KeyboardEvent as ReactKeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';
import { createEditor, Descendant, Editor, Transforms } from 'slate';
import { HistoryEditor, withHistory } from 'slate-history';
import { Editable, ReactEditor, RenderElementProps, Slate, withReact } from 'slate-react';

import { APP_EVENTS } from '@/application/constants';
import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { createDatabaseHistoryGroup } from '@/application/database-yjs/history';
import {
  getMentionedPageIds,
  hasStoredPageTitle,
  isPlainRichText,
  isRichTextTooLarge,
  plainTextToRichText,
  RichTextDelta,
  richTextToPlainText,
  serializeRichTextCellValue,
} from '@/application/database-yjs/fields/text/rich-text';
import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { FieldId, View } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { findView } from '@/components/_shared/outline/utils';
import { isDatabaseHistoryHotkey } from '@/components/database/hooks/useDatabaseRowHistoryHotkeys';
import HrefPopover from '@/components/editor/components/leaf/href/HrefPopover';
import { Leaf } from '@/components/editor/components/leaf/Leaf';
import { useLeafContext } from '@/components/editor/components/leaf/leaf.hooks';
import { MentionPanel } from '@/components/editor/components/panels/mention-panel/MentionPanel';
import { usePanelContext } from '@/components/editor/components/panels/Panels.hooks';
import { PanelProvider, PanelType } from '@/components/editor/components/panels/PanelsContext';
import { cn } from '@/lib/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { Log } from '@/utils/log';
import { isDevelopmentOrTestEnvironment } from '@/utils/runtime-config';

import { getCachedPageName, isPageNameUnavailable, loadPageNames, setCachedPageName } from './page-name-cache';
import RichTextCellContext from './RichTextCellContext';
import { RICH_TEXT_CELL_OVERLAY_ATTR, RichTextCellToolbar } from './RichTextCellToolbar';
import { richTextToSlateValue, slateValueToRichText, toggleEquation, withRichTextCell } from './rich-text-slate';

const isEnterHotkey = createHotkey(HOT_KEY_NAME.ENTER);
const isRedoHotkey = createHotkey(HOT_KEY_NAME.REDO);
const isEscapeHotkey = createHotkey(HOT_KEY_NAME.ESCAPE);
const isBoldHotkey = createHotkey(HOT_KEY_NAME.BOLD);
const isItalicHotkey = createHotkey(HOT_KEY_NAME.ITALIC);
const isUnderlineHotkey = createHotkey(HOT_KEY_NAME.UNDERLINE);
const isStrikethroughHotkey = createHotkey(HOT_KEY_NAME.STRIKETHROUGH);
const isCodeHotkey = createHotkey(HOT_KEY_NAME.CODE);
const isHighlightHotkey = createHotkey(HOT_KEY_NAME.HIGH_LIGHT);

function isEquationHotkey(event: KeyboardEvent) {
  return (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'e';
}

/**
 * Popovers the editor opens (mention panel, link and equation editors, color
 * and date pickers) render in portals. Pointer or focus moving into one of
 * them stays inside the edit session.
 */
const OVERLAY_SELECTOR = [
  `[${RICH_TEXT_CELL_OVERLAY_ATTR}]`,
  '.MuiPopover-root',
  '.MuiPopper-root',
  '[data-radix-popper-content-wrapper]',
].join(',');

function isInsideOverlay(target: EventTarget | null, container: HTMLElement | null) {
  if (!(target instanceof Element)) return false;
  const overlay = target.closest(OVERLAY_SELECTOR);

  // A popover that hosts the cell itself (e.g. a database opened in one) is
  // the cell's surroundings, not one of its overlays.
  return Boolean(overlay) && !(container && overlay?.contains(container));
}

// `@` mentions; `[[` and `+` link a page, as in Notion.
const CELL_PANELS = [PanelType.Mention, PanelType.PageReference];

function hasHighlightedPanelOption() {
  return Boolean(document.querySelector('[data-testid="mention-panel"] [data-option-index].bg-fill-content-hover'));
}

function isEditableElement(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return true;
  return (element as HTMLElement).isContentEditable;
}

function serializeDelta(delta: RichTextDelta) {
  return JSON.stringify(delta);
}

/**
 * A delta in the editor's own shape (key order, merged runs, kept marks), so
 * a value saved by another client in a different JSON layout compares equal
 * to the same content typed here.
 */
function canonicalKey(delta: RichTextDelta) {
  return serializeDelta(slateValueToRichText(richTextToSlateValue(delta)));
}

/** The page ids a delta's plain text names, as one comparable key. */
function mentionedPagesKey(delta: RichTextDelta) {
  return getMentionedPageIds(delta).sort().join(',');
}

type TestEditableElement = HTMLElement & { __richTextCellSelection?: () => string };

// Bursts of title typing are one undo step, as they were in the textarea.
const TITLE_UNDO_PAUSE_MS = 1000;

type EditorWithFlush = ReactEditor & HistoryEditor & { flushLocalChanges?: () => void };

function createCellEditor(singleLine: boolean) {
  const editor = withRichTextCell(withReact(withHistory(createEditor())), { singleLine }) as EditorWithFlush;

  // The mention panel flushes pending Yjs changes before inserting; a cell
  // draft has none, it is saved as a whole on commit.
  editor.flushLocalChanges = () => undefined;
  return editor;
}

function renderElement({ attributes, children }: RenderElementProps) {
  return (
    <div {...attributes} className={'whitespace-pre-wrap break-words'}>
      {children}
    </div>
  );
}

export interface RichTextCellEditorProps {
  rowId: string;
  fieldId: FieldId;
  /** The cell's plain text (`data`). */
  value: string;
  /** The cell's formatting, when it still describes `value`. */
  richText?: RichTextDelta;
  placeholder?: string;
  onExit?: () => void;
  /**
   * `cell` (default) edits a draft saved when the cell is left (Enter,
   * Escape, click outside). `title` is the row page title: always editable,
   * single line, saved as it is typed; Enter and Escape leave it.
   */
  variant?: 'cell' | 'title';
  testId?: string;
  ariaLabel?: string;
  className?: string;
  /** Called with the plain text of every saved value. */
  onSaved?: (text: string) => void;
}

interface RichTextCellEditorInnerProps extends RichTextCellEditorProps {
  editor: EditorWithFlush;
  changeRef: { current?: () => void };
  /** Set when the editor's content failed to render: its draft is not saved. */
  crashedRef: { current: boolean };
}

function RichTextCellEditorInner({
  editor,
  rowId,
  fieldId,
  value,
  richText,
  placeholder,
  onExit,
  variant = 'cell',
  testId = 'rich-text-cell-editor',
  ariaLabel,
  className,
  onSaved,
  changeRef,
  crashedRef,
}: RichTextCellEditorInnerProps) {
  const isTitle = variant === 'title';
  const { t } = useTranslation();
  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);
  const databaseContext = useDatabaseContextOptional();
  const loadViewMeta = databaseContext?.loadViewMeta;
  const workspaceId = databaseContext?.workspaceId ?? '';
  const eventEmitter = databaseContext?.eventEmitter;
  const { activePanel, closePanel } = usePanelContext();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const incoming = useMemo(() => richText ?? plainTextToRichText(value), [richText, value]);
  const incomingKey = useMemo(() => canonicalKey(incoming), [incoming]);
  // The content the draft started from: what "clean" compares against.
  const baseKeyRef = useRef(incomingKey);
  const [dirty, setDirty] = useState(false);
  const [empty, setEmpty] = useState(() => Editor.string(editor, []) === '');
  const dirtyRef = useRef(false);
  const exitedRef = useRef(false);
  const { linkOpen, closeLinkPopover } = useLeafContext();
  const titleUndoGroupRef = useRef<{ group: object; timer?: number } | null>(null);
  // Values this editor saved that may not have come back yet: their echo is
  // not an external change, even when a newer save already went out.
  const pendingKeysRef = useRef(new Set<string>());
  const commitSeqRef = useRef(0);
  // The content the last change handled, so selection-only changes are skipped.
  const changeKeyRef = useRef(incomingKey);
  // The pages last looked up, so a lookup runs only when the mentions change.
  const warmedPagesRef = useRef('');
  // A draft too large to save is reported once until it changes.
  const tooLargeReportedRef = useRef(false);

  // External changes (undo/redo, remote sync) replace a clean draft; a dirty
  // draft keeps owning the editor until it is committed.
  useEffect(() => {
    if (pendingKeysRef.current.delete(incomingKey)) return;
    if (incomingKey === baseKeyRef.current) return;
    baseKeyRef.current = incomingKey;
    if (dirtyRef.current) return;

    Editor.withoutNormalizing(editor, () => {
      editor.children = richTextToSlateValue(incoming);
      Transforms.select(editor, Editor.end(editor, []));
    });
    editor.onChange();
    setEmpty(Editor.string(editor, []) === '');
  }, [editor, incoming, incomingKey]);

  // Look mentioned pages up ahead of the save, so it can use their current
  // names without waiting. A page that cannot be named is not retried on
  // every change (see page-name-cache).
  const warmPageNames = useCallback(
    (delta: RichTextDelta, options?: { refresh?: boolean }) => {
      if (!loadViewMeta) return Promise.resolve();
      return loadPageNames(workspaceId, getMentionedPageIds(delta), loadViewMeta, options);
    },
    [loadViewMeta, workspaceId]
  );

  // Opening the editor reloads the names it may save: a page renamed since
  // the last edit must not be written with its old name.
  useEffect(() => {
    warmedPagesRef.current = mentionedPagesKey(incoming);
    void warmPageNames(incoming, { refresh: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While it is open, renames reach it the way they reach the chips.
  useEffect(() => {
    if (!eventEmitter) return;

    const onViewMeta = (view?: View | null) => {
      if (view?.view_id) setCachedPageName(workspaceId, view.view_id, view.name);
    };

    const onOutline = (outline?: View[]) => {
      if (!Array.isArray(outline)) return;

      getMentionedPageIds(slateValueToRichText(editor.children)).forEach((id) => {
        const view = findView(outline, id);

        if (view) setCachedPageName(workspaceId, id, view.name);
      });
    };

    eventEmitter.on(APP_EVENTS.VIEW_META_CHANGED, onViewMeta);
    eventEmitter.on(APP_EVENTS.OUTLINE_LOADED, onOutline);
    return () => {
      eventEmitter.off(APP_EVENTS.VIEW_META_CHANGED, onViewMeta);
      eventEmitter.off(APP_EVENTS.OUTLINE_LOADED, onOutline);
    };
  }, [editor, eventEmitter, workspaceId]);

  const write = useCallback(
    (delta: RichTextDelta, key: string) => {
      const text = richTextToPlainText(
        delta,
        (id) =>
          getCachedPageName(workspaceId, id) ??
          (hasStoredPageTitle(delta, id) ? undefined : t('menuAppHeader.defaultNewPageName'))
      );
      const formatted = !isPlainRichText(delta);
      let historyGroup: object | undefined;

      if (isTitle) {
        const burst = titleUndoGroupRef.current ?? { group: createDatabaseHistoryGroup() };

        window.clearTimeout(burst.timer);
        burst.timer = window.setTimeout(() => {
          if (titleUndoGroupRef.current === burst) titleUndoGroupRef.current = null;
        }, TITLE_UNDO_PAUSE_MS);
        titleUndoGroupRef.current = burst;
        historyGroup = burst.group;
      }

      pendingKeysRef.current.add(key);
      onUpdateCell(text, undefined, {
        historyGroup,
        // '' clears formatting even when the text is unchanged (un-bolding).
        richText: formatted ? serializeRichTextCellValue(text, delta) : '',
      });
      onSaved?.(text);
    },
    [isTitle, onSaved, onUpdateCell, t, workspaceId]
  );

  /** Saves a dirty draft. Returns false when the draft is too large to save. */
  const commit = useCallback(() => {
    if (!dirtyRef.current) return true;

    const delta = slateValueToRichText(editor.children);

    // Desktop could not save any later edit of the cell: refuse, as Desktop
    // does for its own limits, and keep the draft for the user to trim.
    if (isRichTextTooLarge(delta)) {
      if (!tooLargeReportedRef.current) {
        tooLargeReportedRef.current = true;
        notify.error(t('grid.row.textTooLong'));
      }

      return false;
    }

    tooLargeReportedRef.current = false;
    dirtyRef.current = false;
    setDirty(false);

    const key = serializeDelta(delta);
    const seq = ++commitSeqRef.current;

    baseKeyRef.current = key;

    const unresolved = getMentionedPageIds(delta).filter(
      (id) =>
        getCachedPageName(workspaceId, id) === undefined &&
        !hasStoredPageTitle(delta, id) &&
        !isPageNameUnavailable(workspaceId, id)
    );

    // Nearly always the names are known (loaded when the editor opened, or
    // stored with the mention): save now, so the cell never shows the old
    // value.
    if (unresolved.length === 0 || !loadViewMeta) {
      write(delta, key);
      return true;
    }

    void warmPageNames(delta)
      .then(() => {
        // A newer save went out while the names loaded; this one is stale.
        if (seq === commitSeqRef.current) write(delta, key);
      })
      .catch((error: unknown) => {
        Log.error('[RichTextCellEditor] failed to save cell', { rowId, fieldId, error });
      });
    return true;
  }, [editor, fieldId, loadViewMeta, rowId, t, warmPageNames, workspaceId, write]);

  const exit = useCallback(() => {
    if (exitedRef.current) return;
    if (!commit()) return;
    exitedRef.current = true;
    onExit?.();
  }, [commit, onExit]);

  // Leaving the cell by any route (another cell becomes active, the view
  // unmounts) still saves the draft, unless the editor failed to render it.
  const commitRef = useRef(commit);

  commitRef.current = commit;
  useEffect(
    () => () => {
      if (!crashedRef.current) commitRef.current();
    },
    [crashedRef]
  );

  // Switching tabs or closing the window keeps the draft: save it without
  // leaving the cell.
  useEffect(() => {
    const save = () => commitRef.current();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };

    window.addEventListener('blur', save);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', save);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    // A title stays mounted; it has no edit session to leave.
    if (isTitle) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      if (isInsideOverlay(target, containerRef.current)) return;
      exit();
    };

    document.addEventListener('mousedown', handlePointerDown, true);
    return () => document.removeEventListener('mousedown', handlePointerDown, true);
  }, [exit, isTitle]);

  useEffect(() => {
    // The title loads lazily and must not pull focus from an editor the user
    // already moved to (e.g. the row document below it).
    if (isTitle && isEditableElement(document.activeElement)) return;
    ReactEditor.focus(editor);
    Transforms.select(editor, Editor.end(editor, []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const handleChange = useCallback(() => {
    const delta = slateValueToRichText(editor.children);
    const key = serializeDelta(delta);

    // Selection-only changes are not edits.
    if (key === changeKeyRef.current) return;
    changeKeyRef.current = key;

    const isDirty = key !== baseKeyRef.current;

    setEmpty(Editor.string(editor, []) === '');

    const pages = mentionedPagesKey(delta);

    if (pages !== warmedPagesRef.current) {
      warmedPagesRef.current = pages;
      void warmPageNames(delta);
    }

    if (isDirty !== dirtyRef.current) {
      dirtyRef.current = isDirty;
      setDirty(isDirty);
    }

    // The title saves as it is typed, like the page title.
    if (isTitle && isDirty) commit();
  }, [commit, editor, isTitle, warmPageNames]);

  changeRef.current = handleChange;

  // Lets end-to-end tests wait for Slate to take up a selection made in the
  // DOM (it reads it on a throttled `selectionchange`) instead of sleeping.
  useEffect(() => {
    if (!isDevelopmentOrTestEnvironment() && !('Cypress' in window)) return;

    const element = ReactEditor.toDOMNode(editor, editor) as TestEditableElement;

    element.__richTextCellSelection = () => (editor.selection ? Editor.string(editor, editor.selection) : '');
    return () => {
      delete element.__richTextCellSelection;
    };
  }, [editor]);

  // Leaving the title keeps keyboard focus in its surroundings (the row
  // dialog), so a following Escape still reaches the dialog, as it did
  // when the title was a textarea that kept focus.
  const leaveTitle = useCallback(() => {
    // The nearest focusable ancestor: in a MUI dialog that is its container
    // (the paper itself, role="dialog", cannot take focus).
    const host = containerRef.current?.parentElement?.closest<HTMLElement>('[tabindex]');

    ReactEditor.blur(editor);
    host?.focus({ preventScroll: true });
  }, [editor]);

  // Returns whether the key was handled here. slate-react treats a handler
  // that stops propagation as having handled the key, so the keys it should
  // still process (undo, arrows, deletion) must return false explicitly.
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): boolean => {
      const event = e.nativeEvent;

      // A clean draft lets undo/redo reach the database history. Reported as
      // handled so Slate does not also run (and preventDefault) its own undo.
      if (activePanel === undefined && !dirtyRef.current && isDatabaseHistoryHotkey(event)) return true;

      // Escape leaves the title and still reaches the dialog, which closes.
      if (isTitle && activePanel === undefined && isEscapeHotkey(event)) {
        ReactEditor.blur(editor);
        return true;
      }

      // Keep the grid's own shortcuts (arrows, delete row, ...) out of the editor.
      e.stopPropagation();

      // With nothing highlighted in the mention / page-link panel (e.g. "+1
      // 555" typed as text), Enter closes it and saves, as without a panel.
      if (activePanel !== undefined && isEnterHotkey(event) && !hasHighlightedPanelOption()) {
        e.preventDefault();
        closePanel();
        if (isTitle) {
          leaveTitle();
        } else {
          exit();
        }

        return true;
      }

      // The mention panel owns Enter/Escape/arrows while it is open.
      if (e.defaultPrevented || activePanel !== undefined) return true;
      if (event.isComposing) return false;

      // Undo/redo of the draft. Handled here with the app's hotkeys (which
      // detect the platform from navigator.platform) rather than left to
      // slate-react, which reads the user agent and can disagree, e.g.
      // treating Cmd+Shift+Z as no shortcut under a Windows user agent.
      if (isDatabaseHistoryHotkey(event)) {
        e.preventDefault();
        if (isRedoHotkey(event)) {
          HistoryEditor.redo(editor);
        } else {
          HistoryEditor.undo(editor);
        }

        return true;
      }

      if (isEnterHotkey(event) || isEscapeHotkey(event)) {
        e.preventDefault();
        if (isTitle) {
          leaveTitle();
        } else {
          exit();
        }

        return true;
      }

      // A title has no line breaks.
      if (isTitle && event.key === 'Enter') {
        e.preventDefault();
        return true;
      }

      const toggle = (key: EditorMarkFormat) => {
        e.preventDefault();
        CustomEditor.toggleMark(editor, { key, value: true });
        return true;
      };

      switch (true) {
        case isBoldHotkey(event):
          return toggle(EditorMarkFormat.Bold);
        case isItalicHotkey(event):
          return toggle(EditorMarkFormat.Italic);
        case isUnderlineHotkey(event):
          return toggle(EditorMarkFormat.Underline);
        case isStrikethroughHotkey(event):
          return toggle(EditorMarkFormat.StrikeThrough);
        case isCodeHotkey(event):
          return toggle(EditorMarkFormat.Code);
        case isHighlightHotkey(event):
          e.preventDefault();
          CustomEditor.highlight(editor);
          return true;
        case isEquationHotkey(event): {
          e.preventDefault();
          toggleEquation(editor);
          return true;
        }

        default:
          return false;
      }
    },
    [activePanel, closePanel, editor, exit, isTitle, leaveTitle]
  );

  return (
    <div
      ref={containerRef}
      className={'w-full'}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <Editable
        data-testid={testId}
        aria-label={ariaLabel}
        aria-placeholder={placeholder}
        // Slate marks every editor multi-line; a title has one line.
        {...(isTitle ? { 'aria-multiline': false } : {})}
        data-database-history-hotkeys={dirty ? undefined : 'true'}
        className={cn(
          'relative w-full cursor-text whitespace-pre-wrap break-words text-text-primary outline-none',
          // The empty alternative text keeps the drawn placeholder out of
          // what assistive technology reads as the content.
          empty &&
            "before:pointer-events-none before:absolute before:left-0 before:top-0 before:text-text-tertiary before:content-[attr(data-placeholder)_/_'']",
          className
        )}
        // The placeholder is drawn with CSS so it is never part of the text.
        data-placeholder={placeholder}
        renderElement={renderElement}
        renderLeaf={Leaf}
        onKeyDown={handleKeyDown}
        onBlur={(e) => {
          if (isTitle) return;
          const next = e.relatedTarget;

          // Focus moving to a popover the editor opened stays in the session;
          // focus leaving the window keeps the draft for when it comes back.
          if (!next || isInsideOverlay(next, containerRef.current) || containerRef.current?.contains(next as Node)) return;
          exit();
        }}
      />
      <RichTextCellToolbar />
      <MentionPanel />
      {/* The link hover card's "Edit" opens this, as in the document editor. */}
      <HrefPopover open={!!linkOpen} onClose={() => closeLinkPopover?.()} />
    </div>
  );
}

function RichTextCellEditor(props: RichTextCellEditorProps) {
  const [editor] = useState(() => createCellEditor(props.variant === 'title'));
  const changeRef = useRef<() => void>();
  const crashedRef = useRef(false);
  const [initialValue] = useState<Descendant[]>(() =>
    richTextToSlateValue(props.richText ?? plainTextToRichText(props.value))
  );

  return (
    // Content that cannot be rendered shows as the cell's plain text, and its
    // draft is dropped rather than saved over the cell.
    <ErrorBoundary
      fallback={<>{props.value}</>}
      onError={(error) => {
        crashedRef.current = true;
        Log.error('[RichTextCellEditor] failed to render cell', { rowId: props.rowId, fieldId: props.fieldId, error });
      }}
    >
      <RichTextCellContext rowId={props.rowId} readOnly={false}>
        <Slate editor={editor} initialValue={initialValue} onValueChange={() => changeRef.current?.()}>
          <PanelProvider editor={editor} triggers={CELL_PANELS} triggerAtWordStart>
            <RichTextCellEditorInner {...props} editor={editor} changeRef={changeRef} crashedRef={crashedRef} />
          </PanelProvider>
        </Slate>
      </RichTextCellContext>
    </ErrorBoundary>
  );
}

export default memo(RichTextCellEditor);
