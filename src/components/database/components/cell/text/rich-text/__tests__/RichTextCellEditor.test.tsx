import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import EventEmitter from 'events';
import { Editor, Transforms } from 'slate';
import { ReactEditor, RenderLeafProps } from 'slate-react';

import { APP_EVENTS } from '@/application/constants';
import type { RichTextDelta } from '@/application/database-yjs/fields/text/rich-text';
import { MentionType, View } from '@/application/types';

import { clearPageNameCache } from '../page-name-cache';
import RichTextCellEditor, { RichTextCellEditorProps } from '../RichTextCellEditor';

const mockUpdateCell = jest.fn();
const mockNotifyError = jest.fn();
const mockEditors: ReactEditor[] = [];
let mockContext: Record<string, unknown> = {};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'menuAppHeader.defaultNewPageName' ? 'Untitled' : key) }),
}));
jest.mock('@/application/database-yjs/dispatch', () => ({ useUpdateCellDispatch: () => mockUpdateCell }));
jest.mock('@/application/database-yjs/context', () => ({ useDatabaseContextOptional: () => mockContext }));
jest.mock('@/components/_shared/notify', () => ({
  notify: { error: (...args: unknown[]) => mockNotifyError(...args) },
}));
jest.mock('@/components/editor/components/panels/mention-panel/MentionPanel', () => ({ MentionPanel: () => null }));
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
    mockNotifyError.mockReset();
    mockEditors.length = 0;
    clearPageNameCache();
    mockContext = { workspaceId: 'ws', eventEmitter: new EventEmitter() };
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe('edit session', () => {
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
});
