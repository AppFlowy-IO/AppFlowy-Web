import EventEmitter from 'events';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Editor, Transforms } from 'slate';
import { ReactEditor, RenderLeafProps } from 'slate-react';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  isRichTextTooLarge,
  packRichTextDelta,
  type RichTextDelta,
} from '@/application/database-yjs/fields/text/rich-text';
import { MentionType, View, YDatabaseCell, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import * as selectionToolbarUtils from '@/components/editor/components/toolbar/selection-toolbar/utils';

import { clearPageNameCache } from '../page-name-cache';
import { richTextToSlateValue, slateValueToRichText } from '../rich-text-slate';
import RichTextCellEditor, { RichTextCellEditorProps } from '../RichTextCellEditor';

const mockUpdateCell = jest.fn();
const mockNotifyError = jest.fn();
const mockNotifyPerson = jest.fn();
const mockEditors: ReactEditor[] = [];
let mockPersonPicked: (id: string, requireNotification: boolean) => void;
let mockContext: Record<string, unknown> = {};
let fields: Y.Map<Y.Map<unknown>>;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'menuAppHeader.defaultNewPageName' ? 'Untitled' : key) }),
}));
jest.mock('@/application/database-yjs/dispatch', () => ({ useUpdateCellDispatch: () => mockUpdateCell }));
jest.mock('@/application/database-yjs/context', () => ({ useDatabaseContextOptional: () => mockContext }));
jest.mock('@/components/_shared/notify', () => ({
  notify: { error: (...args: unknown[]) => mockNotifyError(...args) },
}));
jest.mock('@/components/editor/components/panels/mention-panel/MentionPanel', () => ({
  MentionPanel: ({ onPersonPicked }: { onPersonPicked: typeof mockPersonPicked }) => {
    mockPersonPicked = onPersonPicked;
    const { usePanelContext } = jest.requireActual('@/components/editor/components/panels/Panels.hooks');
    const { activePanel } = usePanelContext();

    return activePanel ? <div data-testid='mention-panel' /> : null;
  },
}));
jest.mock('@/components/editor/components/panels/mention-panel/useNotifyPersonMention', () => ({
  useNotifyPersonMention: () => mockNotifyPerson,
}));
jest.mock('@/components/editor/components/leaf/href/HrefPopover', () => ({ __esModule: true, default: () => null }));
jest.mock('../RichTextCellToolbar', () => ({
  RICH_TEXT_CELL_OVERLAY_ATTR: 'data-rich-text-cell-overlay',
  RichTextCellToolbar: () => null,
}));
// A leaf that cannot render "boom", standing in for content a renderer chokes on.
jest.mock('@/components/editor/components/leaf/Leaf', () => ({
  Leaf: ({ attributes, children, text }: RenderLeafProps) => {
    if (text.text.includes('boom')) throw new Error('cannot render');
    return <span {...attributes}>{children}</span>;
  },
}));
jest.mock('../rich-text-slate', () => {
  const actual = jest.requireActual('../rich-text-slate');

  return {
    ...actual,
    withRichTextCell: (...args: Parameters<typeof actual.withRichTextCell>) => {
      const editor = actual.withRichTextCell(...args);

      mockEditors.push(editor);
      return editor;
    },
  };
});

const pageMention = (pageId: string, title?: string): RichTextDelta[number] => ({
  insert: '@',
  attributes: { mention: { type: MentionType.PageRef, page_id: pageId, ...(title ? { data: { title } } : {}) } },
});

function view(id: string, name: string) {
  return { view_id: id, name } as View;
}

function deferredView() {
  let resolve: (value: View) => void = () => undefined;
  const promise = new Promise<View>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderEditor(props: Partial<RichTextCellEditorProps> = {}) {
  const onExit = jest.fn();
  const allProps: RichTextCellEditorProps = { rowId: 'row-1', fieldId: 'field-1', value: 'Hello', onExit, ...props };
  const result = render(<RichTextCellEditor {...allProps} />);
  const editor = mockEditors[mockEditors.length - 1];
  const editable = screen.getByTestId(allProps.testId ?? 'rich-text-cell-editor');

  Object.defineProperty(editable, 'isContentEditable', { value: true });
  // The editor focuses itself and moves the caret to the end on mount.
  await flush();
  return {
    ...result,
    editor,
    editable,
    onExit,
    rerenderWith: (next: Partial<RichTextCellEditorProps>) =>
      result.rerender(<RichTextCellEditor {...allProps} {...next} />),
  };
}

async function typeAtEnd(editor: ReactEditor, text: string) {
  for (const char of text) {
    await act(async () => {
      Transforms.select(editor, Editor.end(editor, []));
      editor.insertText(char);
    });
  }
}

async function pressEnter(editable: HTMLElement, init: Partial<KeyboardEventInit> & { which?: number } = {}) {
  await act(async () => {
    fireEvent.keyDown(editable, { key: 'Enter', keyCode: 13, which: 13, ...init });
  });
}

function savedTexts() {
  return mockUpdateCell.mock.calls.map(([text]) => text);
}

describe('RichTextCellEditor', () => {
  beforeEach(() => {
    mockUpdateCell.mockReset();
    mockUpdateCell.mockResolvedValue('written');
    mockNotifyPerson.mockReset();
    mockNotifyPerson.mockResolvedValue(true);
    mockNotifyError.mockReset();
    mockEditors.length = 0;
    clearPageNameCache();
    const databaseDoc = new Y.Doc();
    const database = new Y.Map();

    fields = new Y.Map();
    databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
    database.set(YjsDatabaseKey.fields, fields);
    for (const fieldId of ['field-1', 'field-2']) {
      const field = new Y.Map();

      fields.set(fieldId, field);
      field.set(YjsDatabaseKey.type, FieldType.RichText);
    }

    mockContext = { workspaceId: 'ws', eventEmitter: new EventEmitter(), databaseDoc };
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe('edit session', () => {
    it('retries the first draft after two overlapping title saves fail', async () => {
      let finishFirst!: (status: undefined) => void;
      let finishSecond!: (status: undefined) => void;

      mockUpdateCell
        .mockReturnValueOnce(
          new Promise((resolve) => {
            finishFirst = resolve;
          })
        )
        .mockReturnValueOnce(
          new Promise((resolve) => {
            finishSecond = resolve;
          })
        );
      const onSaved = jest.fn();
      const { editor } = await renderEditor({ variant: 'title', onSaved });

      await typeAtEnd(editor, '!');
      await typeAtEnd(editor, '?');
      expect(savedTexts()).toEqual(['Hello!', 'Hello!?']);
      await act(async () => finishFirst(undefined));
      await act(async () => finishSecond(undefined));
      expect(onSaved).not.toHaveBeenCalled();
      await act(async () => editor.deleteBackward('character'));
      expect(savedTexts()).toEqual(['Hello!', 'Hello!?', 'Hello!']);
      expect(onSaved).toHaveBeenCalledWith('Hello!');
    });

    it.each(['mounted', 'unmounted', 'restored'])(
      'reports a failed accepted save while %s unless a restore replaced it',
      async (lifecycle) => {
        let finish!: (status: undefined) => void;

        mockUpdateCell.mockReturnValueOnce(
          new Promise((resolve) => {
            finish = resolve;
          })
        );
        const onSaved = jest.fn();
        const { editor, editable, unmount, rerenderWith } = await renderEditor({ onSaved });

        await typeAtEnd(editor, '!');
        await pressEnter(editable);
        if (lifecycle === 'restored') {
          rerenderWith({ value: 'Restored' });
          await flush();
        }

        if (lifecycle !== 'mounted') unmount();
        await act(async () => finish(undefined));
        expect(onSaved).not.toHaveBeenCalled();
        expect(mockNotifyError.mock.calls).toEqual(lifecycle === 'restored' ? [] : [['grid.row.textSaveFailed']]);
      }
    );

    it('reports a thrown save failure after unmount', async () => {
      let fail!: (error: Error) => void;

      mockUpdateCell.mockReturnValueOnce(
        new Promise((_, reject) => {
          fail = reject;
        })
      );
      const { editor, editable, unmount } = await renderEditor();

      await typeAtEnd(editor, '!');
      await pressEnter(editable);
      unmount();
      await act(async () => fail(new Error('offline')));
      expect(mockNotifyError).toHaveBeenCalledWith('grid.row.textSaveFailed');
    });

    it.each([
      ['cleanup', 'retyped'],
      ['cleanup', 'deleted'],
      ['page lookup', 'retyped'],
      ['page lookup', 'deleted'],
      ['row hydration', 'retyped'],
      ['row hydration', 'deleted'],
    ])('does not save during %s after the field is %s', async (stage, change) => {
      const rowDoc = new Y.Doc();
      const row = new Y.Map();
      const cells = new Y.Map();
      const cell = new Y.Map() as YDatabaseCell;
      const name = deferredView();
      let finishHydration!: () => void;
      const hydration = new Promise<void>((resolve) => {
        finishHydration = resolve;
      });

      rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
      row.set(YjsDatabaseKey.cells, cells);
      cells.set('field-1', cell);
      cell.set(YjsDatabaseKey.data, 'Original');
      cell.set(
        YjsDatabaseKey.rich_text,
        '{"v":1,"text":"Original","delta":[{"insert":"Original","attributes":{"bold":true}}]}'
      );
      cell.set(YjsDatabaseKey.field_type, FieldType.RichText);
      const original = rowDoc.toJSON();

      mockContext.rowMap = { 'row-1': rowDoc };
      if (stage === 'page lookup') mockContext.loadViewMeta = jest.fn(() => name.promise);
      mockUpdateCell.mockImplementation(async (text, _date, options) => {
        if (stage === 'row hydration') await hydration;
        if (!options.shouldWrite(cell)) return 'cancelled';
        cell.set(YjsDatabaseKey.data, text);
        cell.set(YjsDatabaseKey.rich_text, options.richText);
        return 'written';
      });
      const onSaved = jest.fn();
      const { editor, editable, unmount, onExit } = await renderEditor({
        value: 'Original',
        richText:
          stage === 'page lookup' ? [pageMention('pending')] : [{ insert: 'Original', attributes: { bold: true } }],
        onSaved,
      });

      await typeAtEnd(editor, '!');
      if (stage !== 'cleanup') await pressEnter(editable);
      if (change === 'deleted') fields.delete('field-1');
      else fields.get('field-1')!.set(YjsDatabaseKey.type, FieldType.Number);
      unmount();
      await act(async () => {
        name.resolve(view('pending', 'Original'));
        finishHydration();
      });
      await flush();

      expect(rowDoc.toJSON()).toEqual(original);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onExit).not.toHaveBeenCalled();
      rowDoc.destroy();
    });

    it('keeps a dirty draft when the cell changes elsewhere, and saves it on Enter', async () => {
      const { editor, editable, onExit, rerenderWith } = await renderEditor();

      await typeAtEnd(editor, ' draft');
      rerenderWith({ value: 'Changed remotely' });
      await flush();
      expect(editable.textContent).toBe('Hello draft');

      await pressEnter(editable);
      expect(savedTexts()).toEqual(['Hello draft']);
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('shows a change made elsewhere while the draft is clean', async () => {
      const { editable, rerenderWith } = await renderEditor();

      rerenderWith({ value: 'Changed remotely' });
      await flush();
      expect(editable.textContent).toBe('Changed remotely');
    });

    it('saves the draft when the window loses focus, without leaving the cell', async () => {
      const { editor, onExit } = await renderEditor();

      await typeAtEnd(editor, '!');
      act(() => {
        window.dispatchEvent(new Event('blur'));
      });
      expect(savedTexts()).toEqual(['Hello!']);
      expect(onExit).not.toHaveBeenCalled();
    });

    it('leaves through its latest onExit on a click outside, without listening for clicks again on each render', async () => {
      const { editor, onExit, rerenderWith } = await renderEditor();
      const addListener = jest.spyOn(document, 'addEventListener');
      const latestOnExit = jest.fn();

      await typeAtEnd(editor, '!');
      // The cell re-renders (e.g. on hover) with a new callback.
      rerenderWith({ onExit: latestOnExit });
      await flush();
      expect(addListener.mock.calls.filter(([type]) => type === 'mousedown')).toHaveLength(0);

      await act(async () => {
        fireEvent.mouseDown(document.body);
      });
      expect(savedTexts()).toEqual(['Hello!']);
      expect(latestOnExit).toHaveBeenCalledTimes(1);
      expect(onExit).not.toHaveBeenCalled();
    });

    it('saves the draft when it unmounts', async () => {
      const { editor, unmount } = await renderEditor();

      await typeAtEnd(editor, '!');
      unmount();
      expect(savedTexts()).toEqual(['Hello!']);
    });

    it('drops a draft its content failed to render instead of saving it over the cell', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { editor, unmount, container } = await renderEditor();

      await typeAtEnd(editor, ' boom');
      // The cell falls back to its saved plain text.
      expect(container.textContent).toBe('Hello');
      unmount();
      expect(mockUpdateCell).not.toHaveBeenCalled();
    });

    it("does not take the late echo of an earlier save of the title for someone else's change", async () => {
      const { editor, editable, rerenderWith } = await renderEditor({
        variant: 'title',
        value: 'X',
        testId: 'row-title-input',
      });

      await typeAtEnd(editor, 'a');
      await typeAtEnd(editor, 'b');
      expect(savedTexts()).toEqual(['Xa', 'Xab']);

      rerenderWith({ value: 'Xa' });
      await flush();
      expect(editable.textContent).toBe('Xab');
      rerenderWith({ value: 'Xab' });
      await flush();
      expect(editable.textContent).toBe('Xab');
    });

    it('accepts a remote title equal to an older save after a newer save is acknowledged', async () => {
      const { editor, editable, rerenderWith } = await renderEditor({ variant: 'title', value: 'X' });

      await typeAtEnd(editor, 'ab');
      expect(savedTexts()).toEqual(['Xa', 'Xab']);

      // React may coalesce both local save echoes into only the latest value.
      rerenderWith({ value: 'Xab' });
      await flush();
      rerenderWith({ value: 'Xa' });
      await flush();
      expect(editable.textContent).toBe('Xa');

      await typeAtEnd(editor, 'c');
      expect(savedTexts()).toEqual(['Xa', 'Xab', 'Xac']);
    });

    it('redoes local formatting after undo restores the saved text', async () => {
      const { editor, editable } = await renderEditor();
      const modifier = /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
      const databaseHistory = jest.fn();

      await act(async () => {
        Transforms.select(editor, Editor.range(editor, []));
        fireEvent.keyDown(editable, { key: 'b', keyCode: 66, which: 66, ...modifier });
      });
      expect(slateValueToRichText(editor.children)).toEqual([{ insert: 'Hello', attributes: { bold: true } }]);

      await act(async () => {
        fireEvent.keyDown(editable, { key: 'z', keyCode: 90, which: 90, ...modifier });
      });
      expect(slateValueToRichText(editor.children)).toEqual([{ insert: 'Hello' }]);
      expect(mockUpdateCell).not.toHaveBeenCalled();

      // Database history listens above the cell; local redo must not reach it.
      document.addEventListener('keydown', databaseHistory);
      try {
        await act(async () => {
          fireEvent.keyDown(editable, { key: 'z', keyCode: 90, which: 90, shiftKey: true, ...modifier });
        });
        expect(slateValueToRichText(editor.children)).toEqual([{ insert: 'Hello', attributes: { bold: true } }]);
        expect(databaseHistory).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', databaseHistory);
      }
    });

    it('discards local redo when a remote value replaces the clean draft', async () => {
      const { editor, editable, rerenderWith } = await renderEditor();
      const modifier = /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
      const databaseHistory = jest.fn();

      await act(async () => {
        Transforms.select(editor, Editor.range(editor, []));
        fireEvent.keyDown(editable, { key: 'b', keyCode: 66, which: 66, ...modifier });
      });
      await act(async () => {
        fireEvent.keyDown(editable, { key: 'z', keyCode: 90, which: 90, ...modifier });
      });
      rerenderWith({ value: 'Remote' });
      await flush();
      expect(editable.textContent).toBe('Remote');

      document.addEventListener('keydown', databaseHistory);
      try {
        await act(async () => {
          fireEvent.keyDown(editable, { key: 'z', keyCode: 90, which: 90, shiftKey: true, ...modifier });
        });
        expect(slateValueToRichText(editor.children)).toEqual([{ insert: 'Remote' }]);
        expect(databaseHistory).toHaveBeenCalledTimes(1);
        expect(mockUpdateCell).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', databaseHistory);
      }
    });

    it.each([
      ['Chrome, which reports key code 229 while composing', 229],
      ['engines that report Enter itself', 13],
    ])('leaves the cell open on Enter that ends an IME composition (%s)', async (_label, which) => {
      const { editor, editable, onExit } = await renderEditor();

      await typeAtEnd(editor, 'か');
      await pressEnter(editable, { keyCode: which, which, isComposing: true });
      expect(onExit).not.toHaveBeenCalled();
      expect(mockUpdateCell).not.toHaveBeenCalled();

      await pressEnter(editable);
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('keeps an unhighlighted mention panel open when Enter confirms IME text', async () => {
      // jsdom has no DOM Range geometry; the panel can use the editor's bounds.
      jest.spyOn(selectionToolbarUtils, 'getRangeRect').mockReturnValue(null);
      const { editor, editable, onExit } = await renderEditor();

      await typeAtEnd(editor, ' @か');
      expect(screen.queryByTestId('mention-panel')).not.toBeNull();

      await pressEnter(editable, { isComposing: true });
      expect(onExit).not.toHaveBeenCalled();
      expect(mockUpdateCell).not.toHaveBeenCalled();
      expect(screen.queryByTestId('mention-panel')).not.toBeNull();
      expect(editable.textContent).toBe('Hello @か');

      await pressEnter(editable);
      expect(savedTexts()).toEqual(['Hello @か']);
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('refuses a draft whose formatting Desktop could not save, and keeps it open', async () => {
      const text = 'é'.repeat(100_001);
      const { editor, editable, onExit } = await renderEditor({
        value: text,
        richText: [{ insert: text, attributes: { bold: true } }],
      });

      await typeAtEnd(editor, '!');
      await pressEnter(editable);
      await pressEnter(editable);
      expect(mockUpdateCell).not.toHaveBeenCalled();
      expect(onExit).not.toHaveBeenCalled();
      expect(mockNotifyError).toHaveBeenCalledTimes(1);
      expect(mockNotifyError).toHaveBeenCalledWith('grid.row.textTooLong');
    });
  });

  describe('page names', () => {
    it('copies a resolved page name even when the mention has no stored title', async () => {
      mockContext.loadViewMeta = jest.fn(async (id: string) => view(id, 'Roadmap'));
      const { editor, editable } = await renderEditor({
        value: 'See Roadmap',
        richText: [{ insert: 'See ' }, pageMention('copy-page')],
      });
      const setData = jest.fn();

      await act(async () => Transforms.select(editor, Editor.range(editor, [])));
      await act(async () => fireEvent.copy(editable, { clipboardData: { setData } }));
      expect(setData).toHaveBeenLastCalledWith('text/plain', 'See Roadmap');
    });

    it.each(['Changed remotely', 'Undone', ''])(
      'discards a deferred title save after replacement with %j',
      async (replacement) => {
        const name = deferredView();

        mockContext.loadViewMeta = jest.fn(() => name.promise);
        const { editor, rerenderWith } = await renderEditor({
          variant: 'title',
          value: 'Plan',
          richText: [pageMention('pending-page')],
        });

        await typeAtEnd(editor, '!');
        rerenderWith({ value: replacement, richText: undefined });
        await flush();
        expect(Editor.string(editor, [])).toBe(replacement);
        await act(async () => name.resolve(view('pending-page', 'Plan')));
        await flush();
        expect(mockUpdateCell).not.toHaveBeenCalled();
      }
    );

    it('keeps the editor open when a resolved page name exceeds the text limit', async () => {
      const name = deferredView();

      mockContext.loadViewMeta = jest.fn(() => name.promise);
      const { editor, editable, onExit } = await renderEditor({ value: 'Plan', richText: [pageMention('large-page')] });

      await typeAtEnd(editor, '!');
      await pressEnter(editable);
      expect(onExit).not.toHaveBeenCalled();
      await act(async () => name.resolve(view('large-page', 'P'.repeat(10_001))));
      await flush();
      expect(onExit).not.toHaveBeenCalled();
      expect(mockUpdateCell).not.toHaveBeenCalled();
      expect(editable.textContent).toBe('@!');
      expect(mockNotifyError).toHaveBeenCalledWith('grid.row.textTooLong');
    });

    it('saves a page renamed since the last edit with its new name', async () => {
      let name = 'Roadmap';
      const loadViewMeta = jest.fn(async (id: string) => view(id, name));

      mockContext.loadViewMeta = loadViewMeta;

      const first = await renderEditor({ value: 'See Roadmap', richText: [{ insert: 'See ' }, pageMention('p1')] });

      await flush();
      await typeAtEnd(first.editor, '!');
      first.unmount();
      expect(savedTexts()).toEqual(['See Roadmap!']);

      name = 'Roadmap 2026';
      const second = await renderEditor({ value: 'Other Roadmap', richText: [{ insert: 'Other ' }, pageMention('p1')] });

      await flush();
      await typeAtEnd(second.editor, '!');
      second.unmount();
      expect(savedTexts()).toEqual(['See Roadmap!', 'Other Roadmap 2026!']);
    });

    it('follows a rename while it is open', async () => {
      mockContext.loadViewMeta = jest.fn(async (id: string) => view(id, 'Roadmap'));
      const { editor, unmount } = await renderEditor({
        value: 'See Roadmap',
        richText: [{ insert: 'See ' }, pageMention('p1')],
      });

      await flush();
      act(() => {
        (mockContext.eventEmitter as EventEmitter).emit(APP_EVENTS.VIEW_META_CHANGED, view('p1', 'Renamed'));
      });
      await typeAtEnd(editor, '!');
      unmount();
      expect(savedTexts()).toEqual(['See Renamed!']);
    });

    it('does not look up a page it cannot name again on every change', async () => {
      const loadViewMeta = jest.fn(async () => {
        throw new Error('no access');
      });

      mockContext.loadViewMeta = loadViewMeta;

      const { editor, unmount } = await renderEditor({
        value: 'See Stored',
        richText: [{ insert: 'See ' }, pageMention('p1', 'Stored')],
      });

      await flush();
      await typeAtEnd(editor, 'abc');
      await act(async () => {
        Transforms.select(editor, Editor.start(editor, []));
      });
      await flush();
      expect(loadViewMeta).toHaveBeenCalledTimes(1);

      unmount();
      // Saved right away, with the title stored with the mention.
      expect(savedTexts()).toEqual(['See Storedabc']);
    });

    it("writes a database row mention as the row's title without looking its database up", async () => {
      const loadViewMeta = jest.fn(async (id: string) => view(id, 'Projects'));

      mockContext.loadViewMeta = loadViewMeta;

      const rowMention = {
        type: MentionType.PageRef,
        page_id: 'db-view',
        database_view_id: 'db-view',
        row_id: 'row-9',
        data: { title: 'Task A' },
      };
      const { editor, unmount } = await renderEditor({
        value: 'See Task A',
        richText: [{ insert: 'See ' }, { insert: '@', attributes: { mention: rowMention } }],
      });

      await flush();
      await typeAtEnd(editor, '!');
      unmount();
      expect(loadViewMeta).not.toHaveBeenCalled();
      expect(savedTexts()).toEqual(['See Task A!']);
    });

    it('drops a save that waited for a page name once a newer save went out', async () => {
      let resolveName: (value: View) => void = () => undefined;
      const loadViewMeta = jest.fn(
        () =>
          new Promise<View>((resolve) => {
            resolveName = resolve;
          })
      );

      mockContext.loadViewMeta = loadViewMeta;

      const { editor } = await renderEditor({
        variant: 'title',
        testId: 'row-title-input',
        value: 'A Plan',
        richText: [{ insert: 'A ' }, pageMention('p2')],
      });

      await typeAtEnd(editor, 'x');
      await typeAtEnd(editor, 'y');
      expect(mockUpdateCell).not.toHaveBeenCalled();

      await act(async () => {
        resolveName(view('p2', 'Plan'));
      });
      await flush();
      expect(savedTexts()).toEqual(['A Planxy']);
    });

    it('drops a delayed save from an earlier session after the reopened cell saves replacement text', async () => {
      let resolveName: (value: View) => void = () => undefined;

      mockContext.loadViewMeta = jest.fn(
        () =>
          new Promise<View>((resolve) => {
            resolveName = resolve;
          })
      );
      const props = { value: 'See Plan', richText: [{ insert: 'See ' }, pageMention('p3')] };
      const first = await renderEditor(props);

      await typeAtEnd(first.editor, ' old');
      await pressEnter(first.editable);
      first.unmount();
      expect(mockUpdateCell).not.toHaveBeenCalled();

      const second = await renderEditor(props);

      await act(async () => {
        Transforms.select(second.editor, Editor.range(second.editor, []));
        second.editor.insertText('Replacement');
      });
      await pressEnter(second.editable);
      expect(savedTexts()).toEqual(['Replacement']);

      await act(async () => {
        resolveName(view('p3', 'Plan'));
      });
      await flush();
      expect(savedTexts()).toEqual(['Replacement']);
    });

    it('finishes a delayed save after unmount when no newer save replaces it', async () => {
      const name = deferredView();

      mockContext.loadViewMeta = jest.fn(() => name.promise);
      const { editor, unmount } = await renderEditor({
        value: 'See Plan',
        richText: [{ insert: 'See ' }, pageMention('p4')],
      });

      await typeAtEnd(editor, '!');
      unmount();
      expect(mockUpdateCell).not.toHaveBeenCalled();

      await act(async () => {
        name.resolve(view('p4', 'Plan'));
      });
      await flush();
      expect(savedTexts()).toEqual(['See Plan!']);
    });

    it('finishes an old save without exiting the newly active cell', async () => {
      const name = deferredView();

      mockContext.loadViewMeta = jest.fn(() => name.promise);
      const first = await renderEditor({ value: 'Plan', richText: [pageMention('pending-exit')] });

      await typeAtEnd(first.editor, '!');
      await pressEnter(first.editable);
      first.unmount();
      const second = await renderEditor({ rowId: 'row-2' });

      await act(async () => name.resolve(view('pending-exit', 'Plan')));
      await flush();
      expect(savedTexts()).toEqual(['Plan!']);
      expect(first.onExit).not.toHaveBeenCalled();
      expect(second.onExit).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(second.editable);
    });

    it.each(['older', 'newer'] as const)(
      'keeps the newest delayed save across sessions when the %s lookup finishes first',
      async (firstResolved) => {
        const oldName = deferredView();
        const newName = deferredView();

        mockContext.loadViewMeta = jest.fn((id: string) => (id === 'old-page' ? oldName.promise : newName.promise));
        const props = { value: 'See Old', richText: [{ insert: 'See ' }, pageMention('old-page')] };
        const first = await renderEditor(props);

        await typeAtEnd(first.editor, '!');
        first.unmount();

        const second = await renderEditor(props);

        await act(async () => {
          Transforms.select(second.editor, Editor.range(second.editor, []));
          Transforms.insertFragment(second.editor, richTextToSlateValue([{ insert: 'See ' }, pageMention('new-page')]));
        });
        second.unmount();
        expect(mockUpdateCell).not.toHaveBeenCalled();

        await act(async () => {
          if (firstResolved === 'older') oldName.resolve(view('old-page', 'Old'));
          else newName.resolve(view('new-page', 'New'));
        });
        await flush();
        expect(savedTexts()).toEqual(firstResolved === 'older' ? [] : ['See New']);

        await act(async () => {
          if (firstResolved === 'older') newName.resolve(view('new-page', 'New'));
          else oldName.resolve(view('old-page', 'Old'));
        });
        await flush();
        expect(savedTexts()).toEqual(['See New']);
      }
    );

    it.each([
      { dimension: 'row', props: { rowId: 'row-2' }, workspaceId: 'ws' },
      { dimension: 'field', props: { fieldId: 'field-2' }, workspaceId: 'ws' },
      { dimension: 'workspace', props: {}, workspaceId: 'other-ws' },
    ])('keeps a delayed save when a different $dimension commits', async ({ props, workspaceId }) => {
      const name = deferredView();

      mockContext.loadViewMeta = jest.fn(() => name.promise);
      const first = await renderEditor({
        value: 'See Plan',
        richText: [{ insert: 'See ' }, pageMention('p5')],
      });

      await typeAtEnd(first.editor, '!');
      first.unmount();
      mockContext.workspaceId = workspaceId;

      const second = await renderEditor(props);

      await typeAtEnd(second.editor, '!');
      await pressEnter(second.editable);
      expect(savedTexts()).toEqual(['Hello!']);

      await act(async () => {
        name.resolve(view('p5', 'Plan'));
      });
      await flush();
      expect(savedTexts()).toEqual(['Hello!', 'See Plan!']);
    });
  });

  it('tells end-to-end tests which text Slate holds selected', async () => {
    const { editor, editable } = await renderEditor({ value: 'Hello world' });

    await act(async () => {
      Transforms.select(editor, { anchor: { path: [0, 0], offset: 6 }, focus: { path: [0, 0], offset: 11 } });
    });
    expect((editable as HTMLElement & { __richTextCellSelection?: () => string }).__richTextCellSelection?.()).toBe(
      'world'
    );
  });

  describe('accessibility', () => {
    it('names the editor and exposes its placeholder', async () => {
      const { editable } = await renderEditor({ value: '', ariaLabel: 'Notes', placeholder: 'Add Notes' });

      expect(editable.getAttribute('aria-label')).toBe('Notes');
      expect(editable.getAttribute('aria-placeholder')).toBe('Add Notes');
      expect(editable.getAttribute('aria-multiline')).toBe('true');
    });

    it('exposes the row title as a single line', async () => {
      const { editable } = await renderEditor({ variant: 'title', testId: 'row-title-input', ariaLabel: 'Row title' });

      expect(editable.getAttribute('aria-multiline')).toBe('false');
    });
  });

  describe('title notification bursts', () => {
    const person = {
      insert: '@',
      attributes: { mention: { type: MentionType.Person, person_id: 'ada', person_name: 'Ada' } },
    };

    it.each(['idle', 'Enter', 'Escape', 'blur'])('flushes a picked recipient only on %s', async (end) => {
      const { editor, editable } = await renderEditor({ variant: 'title', value: '' });

      jest.useFakeTimers();
      try {
        mockPersonPicked('ada', true);
        await act(async () => Transforms.insertFragment(editor, richTextToSlateValue([person])));
        expect(mockUpdateCell).toHaveBeenCalled();
        expect(mockNotifyPerson).not.toHaveBeenCalled();
        if (end === 'idle') {
          await act(async () => {
            await jest.advanceTimersByTimeAsync(999);
          });
          expect(mockNotifyPerson).not.toHaveBeenCalled();
          await act(async () => {
            await jest.advanceTimersByTimeAsync(1);
          });
        } else if (end === 'blur') {
          await act(async () => {
            fireEvent.blur(editable, { relatedTarget: document.body });
          });
        } else {
          await act(async () => {
            fireEvent.keyDown(editable, {
              key: end,
              keyCode: end === 'Enter' ? 13 : 27,
              which: end === 'Enter' ? 13 : 27,
            });
          });
        }

        expect(mockNotifyPerson).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it.each(['delete', 'outside undo'])('cancels the notification after %s during the burst', async (remove) => {
      const { editor, rerenderWith } = await renderEditor({ variant: 'title', value: '' });

      jest.useFakeTimers();
      try {
        mockPersonPicked('ada', true);
        await act(async () => Transforms.insertFragment(editor, richTextToSlateValue([person])));
        if (remove === 'delete') {
          await act(async () => {
            Transforms.select(editor, Editor.range(editor, []));
            Transforms.delete(editor);
          });
        } else {
          rerenderWith({ value: 'Restored' });
        }

        await act(async () => {
          await jest.advanceTimersByTimeAsync(1000);
        });
        expect(mockNotifyPerson).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('format version 1', () => {
    it.each(['written', 'refused-rich-text-newer', undefined])(
      'notifies newly added people only after a %s save',
      async (status) => {
        let resolveSave!: (value: string | undefined) => void;

        mockUpdateCell.mockReturnValueOnce(
          new Promise<string | undefined>((resolve) => {
            resolveSave = resolve;
          })
        );
        const { editor, editable, onExit } = await renderEditor();

        await act(async () => {
          Transforms.insertFragment(
            editor,
            richTextToSlateValue([
              {
                insert: '@',
                attributes: {
                  mention: { type: MentionType.Person, person_id: 'ada', person_name: 'Ada' },
                },
              },
            ])
          );
        });
        mockPersonPicked('ada', true);
        expect(mockNotifyPerson).not.toHaveBeenCalled();
        await pressEnter(editable);
        expect(mockNotifyPerson).not.toHaveBeenCalled();
        await act(async () => resolveSave(status));
        expect(mockNotifyPerson).toHaveBeenCalledTimes(status === 'written' ? 1 : 0);
        expect(onExit).toHaveBeenCalledTimes(status === 'written' ? 1 : 0);
      }
    );

    const ada = {
      insert: '@',
      attributes: { mention: { type: MentionType.Person, person_id: 'ada', person_name: 'Ada' } },
    };

    it.each(['cell', 'title'] as const)(
      'does not notify for person mentions pasted as HTML into a %s',
      async (variant) => {
        const { editor, editable } = await renderEditor({ variant });
        const fragment = window.btoa(encodeURIComponent(JSON.stringify(richTextToSlateValue([ada]))));

        await act(async () =>
          editor.insertData({
            getData: (type: string) =>
              type === 'text/html' ? `<span data-slate-fragment="${fragment}">@Ada</span>` : '',
          } as DataTransfer)
        );
        await pressEnter(editable);
        expect(mockUpdateCell).toHaveBeenCalled();
        expect(mockNotifyPerson).not.toHaveBeenCalled();
      }
    );

    it('does not notify when picking another occurrence of a stored person', async () => {
      const { editor, editable } = await renderEditor({ value: '@Ada', richText: [ada] });

      await act(async () => Transforms.insertFragment(editor, richTextToSlateValue([ada])));
      mockPersonPicked('ada', true);
      await pressEnter(editable);
      expect(mockUpdateCell).toHaveBeenCalled();
      expect(mockNotifyPerson).not.toHaveBeenCalled();
    });

    it.each(['written', 'refused-rich-text-newer'])(
      'a %s save acknowledges picked mentions after unmount, using the saved primary title',
      async (status) => {
        const databaseDoc = new Y.Doc();
        const rowDoc = new Y.Doc();
        const database = new Y.Map();
        const field = new Y.Map();
        const fields = new Y.Map();
        const row = new Y.Map();
        const cells = new Y.Map();
        const titleCell = new Y.Map();

        databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
        database.set(YjsDatabaseKey.fields, fields);
        fields.set('title', field);
        field.set(YjsDatabaseKey.is_primary, true);
        field.set(YjsDatabaseKey.type, FieldType.RichText);
        fields.set('field-1', new Y.Map([[YjsDatabaseKey.type, FieldType.RichText]]));
        rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
        row.set(YjsDatabaseKey.cells, cells);
        cells.set('title', titleCell);
        titleCell.set(YjsDatabaseKey.data, 'Old title');
        mockContext = { ...mockContext, databaseDoc, rowMap: { 'row-1': rowDoc }, activeViewId: 'database-view' };
        let resolveSave!: (value: string) => void;

        mockUpdateCell.mockReturnValueOnce(
          new Promise<string>((resolve) => {
            resolveSave = resolve;
          })
        );
        const { editor, editable, unmount } = await renderEditor();

        await act(async () => Transforms.insertFragment(editor, richTextToSlateValue([ada])));
        mockPersonPicked('ada', false);
        await pressEnter(editable);
        unmount();
        expect(mockNotifyPerson).not.toHaveBeenCalled();
        titleCell.set(YjsDatabaseKey.data, 'Saved row');
        await act(async () => resolveSave(status));
        if (status === 'written') {
          expect(mockNotifyPerson).toHaveBeenCalledTimes(1);
          expect(mockNotifyPerson).toHaveBeenCalledWith(expect.objectContaining({ person_id: 'ada' }), false, {
            viewId: 'database-view',
            rowId: 'row-1',
            rowTitle: 'Saved row',
          });
        } else {
          expect(mockNotifyPerson).not.toHaveBeenCalled();
        }

        databaseDoc.destroy();
        rowDoc.destroy();
      }
    );

    it('keeps delivery state across repeated picks and permits a record-only upgrade', async () => {
      const { editor } = await renderEditor();
      const save = async () => {
        await act(async () => {
          window.dispatchEvent(new Event('blur'));
        });
        await flush();
      };

      await act(async () => Transforms.insertFragment(editor, richTextToSlateValue([ada])));
      mockPersonPicked('ada', false);
      await save();
      await flush();
      await act(async () => Transforms.insertFragment(editor, richTextToSlateValue([ada])));
      mockPersonPicked('ada', true);
      await save();
      await flush();
      await act(async () => {
        Transforms.select(editor, Editor.range(editor, []));
        editor.insertText('Removed');
      });
      await save();
      await act(async () => Transforms.insertFragment(editor, richTextToSlateValue([ada])));
      mockPersonPicked('ada', true);
      await save();
      await flush();
      expect(mockNotifyPerson.mock.calls.map(([, required]) => required)).toEqual([false, true]);
    });

    it('does not notify a person removed from the unsaved draft', async () => {
      const { editor, editable } = await renderEditor();

      await act(async () => {
        Transforms.insertFragment(
          editor,
          richTextToSlateValue([
            {
              insert: '@',
              attributes: {
                mention: { type: MentionType.Person, person_id: 'ada', person_name: 'Ada' },
              },
            },
          ])
        );
      });
      mockPersonPicked('ada', true);
      await act(async () => {
        Transforms.select(editor, Editor.range(editor, []));
        editor.insertText('No mention');
      });
      await pressEnter(editable);
      expect(mockNotifyPerson).not.toHaveBeenCalled();
      expect(savedTexts()).toEqual(['No mention']);
    });

    it('keeps the draft open when adding mention labels exceeds the final delta limit', async () => {
      const { editor, editable, onExit } = await renderEditor({
        value: '@Ada',
        richText: [
          {
            insert: '@',
            attributes: {
              href: 'h'.repeat(190_000),
              mention: { type: MentionType.Person, person_id: 'ada', person_name: 'A'.repeat(6_000) },
            },
          },
        ],
      });

      await act(async () => {
        Transforms.select(editor, Editor.range(editor, []));
        Editor.addMark(editor, 'bold', true);
      });
      expect(isRichTextTooLarge(slateValueToRichText(editor.children))).toBe(false);
      await pressEnter(editable);
      expect(mockUpdateCell).not.toHaveBeenCalled();
      expect(onExit).not.toHaveBeenCalled();
      expect(editable.textContent).toBe('@');
      expect(mockNotifyError).toHaveBeenCalledWith('grid.row.textTooLong');
    });

    it('waits for a confirmed save before leaving or reporting onSaved', async () => {
      let resolveSave!: (status: string) => void;

      mockUpdateCell.mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveSave = resolve;
        })
      );
      const onSaved = jest.fn();
      const { editor, editable, onExit } = await renderEditor({ onSaved });

      await typeAtEnd(editor, '!');
      await pressEnter(editable);
      await pressEnter(editable);
      expect(onExit).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
      await act(async () => resolveSave('refused-rich-text-newer'));
      expect(onExit).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
      expect(editable.textContent).toBe('Hello!');
      expect(mockNotifyError).not.toHaveBeenCalled();
    });

    it('does not retry a refused save after a newer cell value replaces it', async () => {
      let resolveSave!: (status: string) => void;

      mockUpdateCell.mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveSave = resolve;
        })
      );
      const { editor, editable, onExit, rerenderWith } = await renderEditor();

      await typeAtEnd(editor, '!');
      await pressEnter(editable);
      rerenderWith({ value: 'Changed remotely' });
      await flush();
      await act(async () => resolveSave('refused-rich-text-newer'));
      await pressEnter(editable);
      expect(mockUpdateCell).toHaveBeenCalledTimes(1);
      expect(editable.textContent).toBe('Changed remotely');
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    function savedRichTexts() {
      return mockUpdateCell.mock.calls.map(([, , options]) => {
        const raw = (options as { richText?: string } | undefined)?.richText;

        return raw ? JSON.parse(raw) : raw;
      });
    }

    it('saves a version 1 envelope whose known mentions are labelled with the text written for them', async () => {
      const ada = { type: MentionType.Person, person_id: 'u1', person_name: 'Ada' };
      const { editor, editable } = await renderEditor({
        value: 'Hi @Ada',
        richText: [{ insert: 'Hi ' }, { insert: '@', attributes: { mention: ada } }],
      });

      await typeAtEnd(editor, '!');
      await pressEnter(editable);
      expect(savedTexts()).toEqual(['Hi @Ada!']);
      expect(savedRichTexts()).toEqual([
        {
          v: 1,
          text: 'Hi @Ada!',
          delta: [
            { insert: 'Hi ' },
            { insert: '@', attributes: { mention: { ...ada, label: '@Ada' } } },
            { insert: '!' },
          ],
        },
      ]);
    });

    it('writes attributes from a newer client back unchanged after an edit', async () => {
      const stored = [{ insert: 'Hello', attributes: { bold: true, font_size: 14 } }];
      const { editor, editable } = await renderEditor({ value: 'Hello', richText: packRichTextDelta(stored) });

      await typeAtEnd(editor, '!');
      await pressEnter(editable);
      expect(savedRichTexts()).toEqual([
        { v: 1, text: 'Hello!', delta: [{ insert: 'Hello!', attributes: { bold: true, font_size: 14 } }] },
      ]);
    });

    it('refuses a draft whose plain text Desktop could not save, and keeps it open (R48)', async () => {
      const text = 'a'.repeat(10_000);
      const { editor, editable, onExit } = await renderEditor({ value: text });

      await typeAtEnd(editor, '!');
      await pressEnter(editable);
      expect(mockUpdateCell).not.toHaveBeenCalled();
      expect(onExit).not.toHaveBeenCalled();
      expect(mockNotifyError).toHaveBeenCalledWith('grid.row.textTooLong');

      // Trimming it back under the limit saves.
      await act(async () => {
        Transforms.select(editor, Editor.end(editor, []));
        editor.deleteBackward('character');
        editor.deleteBackward('character');
      });
      await pressEnter(editable);
      expect(savedTexts()).toEqual(['a'.repeat(9_999)]);
    });

    it('cleans unpaired surrogates out of what it saves (R21)', async () => {
      const { editor, editable } = await renderEditor({
        value: 'x',
        richText: [{ insert: 'x', attributes: { bold: true } }],
      });

      await typeAtEnd(editor, '\ud800');
      await pressEnter(editable);
      expect(savedTexts()).toEqual(['x\ufffd']);
      expect(savedRichTexts()[0].text).toBe('x\ufffd');
    });

    it('keeps a title clean when its labelled save comes back (R37b)', async () => {
      const ada = { type: MentionType.Person, person_id: 'u1', person_name: 'Ada' };
      const { editor, editable, rerenderWith } = await renderEditor({
        variant: 'title',
        testId: 'row-title-input',
        value: 'Hi @Ada',
        richText: [{ insert: 'Hi ' }, { insert: '@', attributes: { mention: ada } }],
      });

      await typeAtEnd(editor, '!');
      const children = editor.children;
      const caret = editor.selection;
      const undos = editor.history.undos.length;
      const [[text, , options]] = mockUpdateCell.mock.calls;
      const echo = JSON.parse((options as { richText: string }).richText);

      // The echo carries labels the draft does not hold: still this editor's own save.
      expect(echo.delta[1].attributes.mention.label).toBe('@Ada');
      rerenderWith({ value: text as string, richText: packRichTextDelta(echo.delta) });
      await flush();
      // Not replaced: same content, caret and undo history.
      expect(editor.children).toBe(children);
      expect(editable.textContent).toBe('Hi @!');
      expect(editor.selection).toEqual(caret);
      expect(editor.history.undos.length).toBe(undos);
    });

    it('keeps a draft the cell refused to save dirty, so it is saved again', async () => {
      mockUpdateCell.mockResolvedValueOnce('refused-rich-text-newer');
      const { editor, editable } = await renderEditor();

      await typeAtEnd(editor, '!');
      act(() => {
        window.dispatchEvent(new Event('blur'));
      });
      await flush();
      await pressEnter(editable);
      expect(savedTexts()).toEqual(['Hello!', 'Hello!']);
    });
  });
});
