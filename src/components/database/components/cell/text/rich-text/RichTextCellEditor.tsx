import { KeyboardEvent as ReactKeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';
import { createEditor, Descendant, Editor, Transforms } from 'slate';
import { HistoryEditor, withHistory } from 'slate-history';
import { Editable, ReactEditor, RenderElementProps, Slate, withReact } from 'slate-react';

import { APP_EVENTS } from '@/application/constants';
import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import {
  encodeRichTextCellValue,
  getMentionedPageIds,
  hasStoredPageTitle,
  isRichTextTextTooLong,
  isRichTextTooLarge,
  plainTextToRichText,
  RichTextDelta,
  richTextDeltaKey,
  RichTextPageNameResolver,
  richTextToPlainText,
  sanitizeMention,
  toWellFormedDeep,
  toWellFormedText,
  withMentionLabels,
} from '@/application/database-yjs/fields/text/rich-text';
import { createDatabaseHistoryGroup } from '@/application/database-yjs/history';
import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import {
  FieldId,
  MentionType,
  View,
  YDatabase,
  YDatabaseCell,
  YDatabaseRow,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { findView } from '@/components/_shared/outline/utils';
import { isDatabaseHistoryHotkey } from '@/components/database/hooks/useDatabaseRowHistoryHotkeys';
import HrefPopover from '@/components/editor/components/leaf/href/HrefPopover';
import { Leaf } from '@/components/editor/components/leaf/Leaf';
import { useLeafContext } from '@/components/editor/components/leaf/leaf.hooks';
import { MentionPanel } from '@/components/editor/components/panels/mention-panel/MentionPanel';
import { useNotifyPersonMention } from '@/components/editor/components/panels/mention-panel/useNotifyPersonMention';
import { usePanelContext } from '@/components/editor/components/panels/Panels.hooks';
import { PanelProvider, PanelType } from '@/components/editor/components/panels/PanelsContext';
import { cn } from '@/lib/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { Log } from '@/utils/log';
import { isDevelopmentOrTestEnvironment } from '@/utils/runtime-config';

import { getCachedPageName, isPageNameUnavailable, loadPageNames, setCachedPageName } from './page-name-cache';
import { attachCellMentionLedger, CellMentionLedger } from './cell-mention-ledger';
import { richTextToSlateValue, slateValueToRichText, toggleEquation, withRichTextCell } from './rich-text-slate';
import RichTextCellContext from './RichTextCellContext';
import { RICH_TEXT_CELL_OVERLAY_ATTR, RichTextCellToolbar } from './RichTextCellToolbar';

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
  return Boolean(document.querySelector('[data-testid="mention-panel"] [data-option-index][data-selected="true"]'));
}

function isEditableElement(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return true;
  return (element as HTMLElement).isContentEditable;
}

/** A delta's content as one comparable key, in any key order. */
function serializeDelta(delta: RichTextDelta) {
  return richTextDeltaKey(delta);
}

/**
 * A delta in the editor's own shape (merged runs, kept marks, known mentions
 * without their label), so a value saved by another client in a different
 * JSON layout, or this editor's own save coming back labelled, compares
 * equal to the same content typed here (rich text spec R37b).
 */
function canonicalKey(delta: RichTextDelta) {
  return serializeDelta(slateValueToRichText(richTextToSlateValue(delta)));
}

/** The base of a draft whose save did not go through: it stays dirty until saved. */
const UNSAVED_BASE_KEY = '\u0000unsaved';

/** The page ids a delta's plain text names, as one comparable key. */
function mentionedPagesKey(delta: RichTextDelta) {
  return getMentionedPageIds(delta).sort().join(',');
}

function personMentions(delta: RichTextDelta) {
  const people = new Map<string, NonNullable<ReturnType<typeof sanitizeMention>>>();

  delta.forEach(({ attributes }) => {
    const mention = sanitizeMention(attributes?.mention);

    if (mention?.type === MentionType.Person && mention.person_id) people.set(mention.person_id, mention);
  });
  return people;
}

type TestEditableElement = HTMLElement & { __richTextCellSelection?: () => string };

// Bursts of title typing are one undo step, as they were in the textarea.
const TITLE_UNDO_PAUSE_MS = 1000;

// A page-name lookup can outlive the editor that started it. Track only
// outstanding saves, shared across sessions, so a newer commit to the same
// cell invalidates the older lookup without dropping saves on unmount.
const pendingCellSaves = new Map<string, symbol>();

type EditorWithFlush = ReactEditor & HistoryEditor & { flushLocalChanges?: () => void };

function createCellEditor(singleLine: boolean, plainTextOf: (delta: RichTextDelta) => string) {
  const editor = withRichTextCell(withReact(withHistory(createEditor())), {
    singleLine,
    plainTextOf,
  }) as EditorWithFlush;

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
  plainTextRef: { current: (delta: RichTextDelta) => string };
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
  plainTextRef,
  crashedRef,
}: RichTextCellEditorInnerProps) {
  const isTitle = variant === 'title';
  const { t } = useTranslation();
  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);
  const notifyPersonMention = useNotifyPersonMention();
  const databaseContext = useDatabaseContextOptional();
  const loadViewMeta = databaseContext?.loadViewMeta;
  const workspaceId = databaseContext?.workspaceId ?? '';
  const rowDoc = databaseContext?.rowMap?.[rowId];
  const cellKey = JSON.stringify([workspaceId, rowId, fieldId]);
  const eventEmitter = databaseContext?.eventEmitter;
  const { activePanel, closePanel } = usePanelContext();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const incoming = useMemo(() => richText ?? plainTextToRichText(value), [richText, value]);
  const incomingKey = useMemo(() => canonicalKey(incoming), [incoming]);
  const mentionLedgerRef = useRef<CellMentionLedger>();
  const onPersonPicked = useCallback((id: string, requireNotification: boolean) => {
    mentionLedgerRef.current?.pick(id, requireNotification);
  }, []);
  const savedRowTitle = useCallback(() => {
    const database = databaseContext?.databaseDoc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as
      | YDatabase
      | undefined;
    const fields = database?.get(YjsDatabaseKey.fields);
    const primaryId = [...(fields?.entries() ?? [])].find(([, field]) => field.get(YjsDatabaseKey.is_primary))?.[0];
    const row = rowDoc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
    const title = primaryId ? row?.get(YjsDatabaseKey.cells)?.get(primaryId)?.get(YjsDatabaseKey.data) : undefined;

    return typeof title === 'string' ? title : '';
  }, [databaseContext?.databaseDoc, rowDoc]);
  // The content the draft started from: what "clean" compares against.
  const baseKeyRef = useRef(incomingKey);
  const [dirty, setDirty] = useState(false);
  const [empty, setEmpty] = useState(() => Editor.string(editor, []) === '');
  const dirtyRef = useRef(false);
  const exitedRef = useRef(false);
  const sessionRef = useRef<symbol>();
  const { linkOpen, closeLinkPopover } = useLeafContext();
  const titleUndoGroupRef = useRef<{ group: object; timer?: number } | null>(null);
  // Values this editor saved that may not have come back yet: their echo is
  // not an external change, even when a newer save already went out.
  const pendingKeysRef = useRef<string[]>([]);
  // The content the last change handled, so selection-only changes are skipped.
  const changeKeyRef = useRef(incomingKey);
  // The pages last looked up, so a lookup runs only when the mentions change.
  const warmedPagesRef = useRef('');
  // A draft too large to save is reported once until it changes.
  const tooLargeReportedRef = useRef(false);
  const pendingCommitRef = useRef<Promise<boolean>>();
  const observedIncomingRef = useRef(JSON.stringify([value, incomingKey]));
  const isTextField = useCallback(() => {
    // A field switch can leave the cell's raw value untouched. Read the live
    // schema, including deletion/replacement, rather than the render's field.
    const database = databaseContext?.databaseDoc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as
      | YDatabase
      | undefined;
    const field = database?.get(YjsDatabaseKey.fields)?.get(fieldId);

    return Number(field?.get(YjsDatabaseKey.type)) === FieldType.RichText;
  }, [databaseContext?.databaseDoc, fieldId]);

  // External changes (undo/redo, remote sync) replace a clean draft; a dirty
  // draft keeps owning the editor until it is committed.
  useEffect(() => {
    const observedKey = JSON.stringify([value, incomingKey]);
    const changed = observedIncomingRef.current !== observedKey;

    observedIncomingRef.current = observedKey;
    const acknowledgedIndex = pendingKeysRef.current.lastIndexOf(incomingKey);

    if (acknowledgedIndex !== -1) {
      // React can coalesce several saves into one echo. Once it acknowledges
      // a save, earlier values must be allowed to arrive as remote changes.
      pendingKeysRef.current.splice(0, acknowledgedIndex + 1);
      return;
    }

    if (changed) {
      pendingCellSaves.delete(cellKey);
      pendingCommitRef.current = undefined;
      mentionLedgerRef.current?.outsideValue(new Set(personMentions(incoming).keys()));
    }

    if (incomingKey === baseKeyRef.current) return;
    baseKeyRef.current = incomingKey;
    if (dirtyRef.current) return;

    // Local operations describe the previous value and cannot be replayed
    // against this replacement from database history or another client.
    editor.history = { undos: [], redos: [] };
    Editor.withoutNormalizing(editor, () => {
      editor.children = richTextToSlateValue(incoming);
      Transforms.select(editor, Editor.end(editor, []));
    });
    editor.onChange();
    setEmpty(Editor.string(editor, []) === '');
  }, [cellKey, editor, incoming, incomingKey, value]);

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

  /** The names a save writes for the pages a delta mentions. */
  const pageNameResolver = useCallback(
    (delta: RichTextDelta): RichTextPageNameResolver =>
      (id) =>
        getCachedPageName(workspaceId, id) ??
        (hasStoredPageTitle(delta, id) ? undefined : t('menuAppHeader.defaultNewPageName')),
    [t, workspaceId]
  );

  plainTextRef.current = (delta) => richTextToPlainText(delta, pageNameResolver(delta));

  /** Reports a draft that cannot be saved once, until it changes. */
  const reportTooLong = useCallback(() => {
    if (tooLargeReportedRef.current) return;
    tooLargeReportedRef.current = true;
    notify.error(t('grid.row.textTooLong'));
  }, [t]);

  /** A save that did not go through leaves the draft dirty, to be saved again. */
  const keepDraftUnsaved = useCallback(() => {
    baseKeyRef.current = UNSAVED_BASE_KEY;
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  const write = useCallback(
    async (
      draft: RichTextDelta,
      key: string,
      shouldWrite: (cell: YDatabaseCell | undefined) => boolean,
      isCurrent: () => boolean,
      mentionLedger?: CellMentionLedger
    ) => {
      const resolvePageName = pageNameResolver(draft);
      // Every known mention is labelled with the text written for it (R37),
      // and nothing stored holds an unpaired surrogate (R21).
      const delta = toWellFormedDeep(withMentionLabels(draft, resolvePageName));
      const text = toWellFormedText(richTextToPlainText(delta, resolvePageName));
      // '' clears formatting even when the text is unchanged (un-bolding).
      const richText = encodeRichTextCellValue(text, delta);

      // Page names resolved since the commit can make the value too large.
      if (isRichTextTextTooLong(text) || isRichTextTooLarge(delta)) {
        reportTooLong();
        keepDraftUnsaved();
        return false;
      }

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

      pendingKeysRef.current.push(key);
      const status = await onUpdateCell(text, undefined, { historyGroup, richText, shouldWrite });

      if (status !== 'written' && status !== 'noop') {
        const pendingIndex = pendingKeysRef.current.lastIndexOf(key);

        if (pendingIndex !== -1) pendingKeysRef.current.splice(pendingIndex, 1);
        if (status !== 'cancelled' && isCurrent()) keepDraftUnsaved();
        return false;
      }

      if (status === 'written') {
        const people = personMentions(delta);
        const target = {
          viewId: databaseContext?.activeViewId ?? databaseContext?.databasePageId ?? '',
          rowId,
          rowTitle: isTitle ? text : savedRowTitle(),
        };

        mentionLedger?.saved(
          new Set(people.keys()),
          (id, required) => notifyPersonMention({ type: MentionType.Person, person_id: id }, required, target),
          isTitle ? TITLE_UNDO_PAUSE_MS : undefined
        );

        onSaved?.(text);
      }

      return true;
    },
    [
      databaseContext?.activeViewId,
      databaseContext?.databasePageId,
      isTitle,
      keepDraftUnsaved,
      notifyPersonMention,
      onSaved,
      onUpdateCell,
      pageNameResolver,
      reportTooLong,
      rowId,
      savedRowTitle,
    ]
  );

  /**
   * Saves a dirty draft. Resolves false if validation or the write fails.
   * A caller that has just read the draft passes it, so it is not read twice.
   */
  const commit = useCallback(
    (draft?: { delta: RichTextDelta; key: string }) => {
      if (!isTextField()) return Promise.resolve(false);
      if (!dirtyRef.current) return pendingCommitRef.current ?? Promise.resolve(true);

      const delta = draft?.delta ?? slateValueToRichText(editor.children);
      const key = draft?.key ?? serializeDelta(delta);

      // Desktop could not save any later edit of the cell: refuse, as Desktop
      // does for its own limits (R48), and keep the draft for the user to trim.
      if (isRichTextTooLarge(delta, key) || isRichTextTextTooLong(richTextToPlainText(delta, pageNameResolver(delta)))) {
        reportTooLong();
        return Promise.resolve(false);
      }

      tooLargeReportedRef.current = false;
      dirtyRef.current = false;
      setDirty(false);

      baseKeyRef.current = key;

      const unresolved = getMentionedPageIds(delta).filter(
        (id) =>
          getCachedPageName(workspaceId, id) === undefined &&
          !hasStoredPageTitle(delta, id) &&
          !isPageNameUnavailable(workspaceId, id)
      );

      const token = Symbol();
      const deferred = unresolved.length > 0 && Boolean(loadViewMeta);
      const row = rowDoc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
      const originalCell = row?.get(YjsDatabaseKey.cells)?.get(fieldId);
      const originalData = originalCell?.get(YjsDatabaseKey.data);
      const originalRichText = originalCell?.get(YjsDatabaseKey.rich_text);
      const isCurrent = () => pendingCellSaves.get(cellKey) === token;
      const shouldWrite = (cell: YDatabaseCell | undefined) =>
        isCurrent() &&
        isTextField() &&
        (!deferred ||
          !rowDoc ||
          (cell === originalCell &&
            cell?.get(YjsDatabaseKey.data) === originalData &&
            cell?.get(YjsDatabaseKey.rich_text) === originalRichText));

      pendingCellSaves.set(cellKey, token);
      const mentionLedger = mentionLedgerRef.current;

      mentionLedger?.beginSave();
      const save = () =>
        isCurrent() && isTextField() ? write(delta, key, shouldWrite, isCurrent, mentionLedger) : Promise.resolve(false);
      const pending = (deferred ? warmPageNames(delta).then(save) : save())
        .catch((error: unknown) => {
          Log.error('[RichTextCellEditor] failed to save cell', { rowId, fieldId, error });
          if (isCurrent()) keepDraftUnsaved();
          return false;
        })
        .finally(() => {
          if (isCurrent()) pendingCellSaves.delete(cellKey);
          if (pendingCommitRef.current === pending) pendingCommitRef.current = undefined;
          mentionLedger?.finishSave();
        });

      pendingCommitRef.current = pending;
      return pending;
    },
    [
      cellKey,
      editor,
      fieldId,
      isTextField,
      keepDraftUnsaved,
      loadViewMeta,
      pageNameResolver,
      reportTooLong,
      rowDoc,
      rowId,
      warmPageNames,
      workspaceId,
      write,
    ]
  );

  const exit = useCallback(() => {
    const session = sessionRef.current;

    if (!session || exitedRef.current) return;
    void commit().then((saved) => {
      if (!saved || dirtyRef.current || exitedRef.current || sessionRef.current !== session) return;
      void mentionLedgerRef.current?.flush();
      exitedRef.current = true;
      onExit?.();
    });
  }, [commit, onExit]);

  // The listeners below are attached once and read the latest of these.
  const commitRef = useRef(commit);
  const exitRef = useRef(exit);

  commitRef.current = commit;
  exitRef.current = exit;

  // Leaving the cell by any route (another cell becomes active, the view
  // unmounts) still saves the draft, unless the editor failed to render it.
  useEffect(() => {
    const ledger = attachCellMentionLedger(cellKey, new Set(personMentions(incoming).keys()));

    sessionRef.current = Symbol();
    mentionLedgerRef.current = ledger;
    return () => {
      // Pending writes may finish after unmount; their UI callbacks may not.
      sessionRef.current = undefined;
      // Read the latest crash flag so a failed renderer never saves its draft.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (!crashedRef.current) void commitRef.current();
      ledger.detach();
    };
    // The editor and its ledger share one mount lifetime, just like Slate's initialValue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crashedRef]);

  const finishEditing = useCallback(() => {
    void commitRef.current().then((saved) => {
      if (saved) void mentionLedgerRef.current?.flush();
    });
  }, []);

  // Switching tabs or closing the window keeps the draft: save it without
  // leaving the cell.
  useEffect(() => {
    const save = () => {
      finishEditing();
    };

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
  }, [finishEditing]);

  useEffect(() => {
    // A title stays mounted; it has no edit session to leave.
    if (isTitle) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      if (isInsideOverlay(target, containerRef.current)) return;
      exitRef.current();
    };

    document.addEventListener('mousedown', handlePointerDown, true);
    return () => document.removeEventListener('mousedown', handlePointerDown, true);
  }, [isTitle]);

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
    if (isTitle && isDirty) void commit({ delta, key });
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

    finishEditing();
    ReactEditor.blur(editor);
    host?.focus({ preventScroll: true });
  }, [editor, finishEditing]);

  // Returns whether the key was handled here. slate-react treats a handler
  // that stops propagation as having handled the key, so the keys it should
  // still process (undo, arrows, deletion) must return false explicitly.
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): boolean => {
      const event = e.nativeEvent;

      // Leave confirmation to the IME, without Slate interpreting it as a
      // newline or the panel submitting the draft. Keep browser defaults.
      if (event.isComposing) {
        e.stopPropagation();
        return true;
      }

      // Undo can restore a clean draft while leaving formatting to redo
      // locally. Other clean-draft history shortcuts reach database history.
      // Report them as handled so Slate does not also run its own history.
      const hasLocalRedo = isRedoHotkey(event) && editor.history.redos.length > 0;

      if (activePanel === undefined && !dirtyRef.current && !hasLocalRedo && isDatabaseHistoryHotkey(event)) return true;

      // Escape leaves the title and still reaches the dialog, which closes.
      if (isTitle && activePanel === undefined && isEscapeHotkey(event)) {
        finishEditing();
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
    [activePanel, closePanel, editor, exit, finishEditing, isTitle, leaveTitle]
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
          const next = e.relatedTarget;

          // Focus moving to a popover the editor opened stays in the session;
          // focus leaving the window keeps the draft for when it comes back.
          if (!next || isInsideOverlay(next, containerRef.current) || containerRef.current?.contains(next as Node))
            return;
          if (isTitle) finishEditing();
          else exit();
        }}
      />
      <RichTextCellToolbar />
      <MentionPanel notifyOnInsert={false} onPersonPicked={onPersonPicked} />
      {/* The link hover card's "Edit" opens this, as in the document editor. */}
      <HrefPopover open={!!linkOpen} onClose={() => closeLinkPopover?.()} />
    </div>
  );
}

function RichTextCellEditor(props: RichTextCellEditorProps) {
  const plainTextRef = useRef<(delta: RichTextDelta) => string>(richTextToPlainText);
  const [editor] = useState(() => createCellEditor(props.variant === 'title', (delta) => plainTextRef.current(delta)));
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
            <RichTextCellEditorInner
              {...props}
              editor={editor}
              changeRef={changeRef}
              plainTextRef={plainTextRef}
              crashedRef={crashedRef}
            />
          </PanelProvider>
        </Slate>
      </RichTextCellContext>
    </ErrorBoundary>
  );
}

export default memo(RichTextCellEditor);
