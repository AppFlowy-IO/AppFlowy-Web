import EventEmitter from 'events';

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createEditor, Descendant, Editor, Element, Node, Range, Transforms } from 'slate';
import { withHistory } from 'slate-history';
import { Editable, ReactEditor, RenderElementProps, Slate, withReact } from 'slate-react';

import { APP_EVENTS } from '@/application/constants';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { withYjs, YjsEditor } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, MentionType, YjsEditorKey } from '@/application/types';
import { Leaf } from '@/components/editor/components/leaf/Leaf';
import { EditorContextProvider } from '@/components/editor/EditorContext';
import { clipboardFormatKey, withCopy } from '@/components/editor/plugins/withCopy';
import { withInsertData } from '@/components/editor/plugins/withInsertData';
import { withPasted } from '@/components/editor/plugins/withPasted';

import { clearPageNameCache } from '../page-name-cache';
import { richTextToSlateValue, slateValueToRichText, withRichTextCell, withRichTextCellCopy } from '../rich-text-slate';
import * as richTextSlate from '../rich-text-slate';
import RichTextCellDocument from '../RichTextCellDocument';

jest.mock('@/components/editor/parsers/html-parser', () => ({ parseHTML: jest.fn(() => []) }));
jest.mock('@/components/editor/parsers/markdown-parser', () => ({ parseMarkdown: jest.fn(() => []) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'menuAppHeader.defaultNewPageName' ? 'Untitled' : key) }),
}));

const formatted = richTextToSlateValue([{ insert: 'Hello ' }, { insert: 'world', attributes: { bold: true } }]);

function clipboardData(values: Record<string, string> = {}): DataTransfer {
  return {
    files: [],
    get types() {
      return Object.keys(values);
    },
    getData: (type: string) => values[type] ?? '',
    setData: (type: string, value: string) => {
      values[type] = value;
    },
  } as unknown as DataTransfer;
}

function renderElement({ attributes, children }: RenderElementProps) {
  return <div {...attributes}>{children}</div>;
}

/** Copies everything from a cell editor the way the browser's copy event does. */
async function copyFromCell(
  editor: Editor,
  readOnly = false,
  {
    initialValue = formatted,
    selection,
    cut = false,
  }: { initialValue?: Descendant[]; selection?: Range; cut?: boolean } = {}
) {
  const view = render(
    <EditorContextProvider workspaceId='workspace' viewId='view' readOnly={readOnly}>
      <Slate editor={editor} initialValue={initialValue}>
        <Editable data-testid='cell' readOnly={readOnly} renderElement={renderElement} renderLeaf={Leaf} />
      </Slate>
    </EditorContextProvider>
  );
  const editable = view.getByTestId('cell');

  Object.defineProperty(editable, 'isContentEditable', { value: true });
  await act(async () => {
    Transforms.select(editor, selection ?? Editor.range(editor, []));
  });

  const clipboard = clipboardData();

  await act(async () => {
    if (cut) fireEvent.cut(editable, { clipboardData: clipboard });
    else fireEvent.copy(editable, { clipboardData: clipboard });
  });
  cleanup();
  return clipboard;
}

/** Pastes into a document paragraph "Doc " and returns each paragraph's text. */
async function pasteIntoDocument(clipboard: DataTransfer) {
  const doc = withTestingYDoc('clipboard-page');

  slateContentInsertToYData(
    'clipboard-page',
    0,
    [
      {
        type: BlockType.Paragraph,
        data: {},
        children: [{ type: YjsEditorKey.text, children: [{ text: 'Doc ' }] }],
      } as unknown as Element,
    ],
    doc
  );

  const editor = withInsertData(
    withPasted(
      withCopy(
        withReact(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local }), clipboardFormatKey)
      )
    )
  ) as YjsEditor;

  editor.connect();
  const view = render(
    <Slate editor={editor} initialValue={editor.children}>
      <Editable data-testid='doc' renderElement={renderElement} scrollSelectionIntoView={() => undefined} />
    </Slate>
  );
  const editable = view.getByTestId('doc');

  Object.defineProperty(editable, 'isContentEditable', { value: true });
  await act(async () => {
    editor.select(Editor.end(editor, [0]));
  });
  await act(async () => {
    fireEvent.paste(editable, { clipboardData: clipboard });
    editor.flushLocalChanges();
  });

  const paragraphs = yDocToSlateContent(doc).children.map((node) => Node.string(node as Node));

  editor.disconnect();
  cleanup();
  return paragraphs;
}

describe('copying from a Text cell into a document', () => {
  it('copies the displayed page title and later renames from a read-only cell', async () => {
    let editor!: ReactEditor;
    const copy = richTextSlate.withRichTextCellCopy;

    jest.spyOn(richTextSlate, 'withRichTextCellCopy').mockImplementation((value, plainTextOf) => {
      editor = value;
      return copy(value, plainTextOf);
    });
    const eventEmitter = new EventEmitter();
    const context = {
      eventEmitter,
      workspaceId: 'workspace',
      activeViewId: 'database',
      loadViewMeta: jest.fn(async () => ({ view_id: 'saved-page', name: 'Live roadmap', layout: 0 })),
    } as unknown as DatabaseContextState;
    const { container } = render(
      <DatabaseContext.Provider value={context}>
        <RichTextCellDocument
          rowId='row'
          lineClassName=''
          delta={[
            { insert: 'See ' },
            {
              insert: '@',
              attributes: { mention: { type: MentionType.PageRef, page_id: 'saved-page', label: 'Saved roadmap' } },
            },
          ]}
        />
      </DatabaseContext.Provider>
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('.mention-content')?.textContent).toBe('Live roadmap');
    const editable = container.querySelector('[data-slate-editor]')!;

    Object.defineProperty(editable, 'isContentEditable', { value: true });
    await act(async () => Transforms.select(editor, Editor.range(editor, [])));
    const clipboard = clipboardData();

    await act(async () => fireEvent.copy(editable, { clipboardData: clipboard }));
    expect(clipboard.getData('text/plain')).toBe('See Live roadmap');
    await act(async () => {
      eventEmitter.emit(APP_EVENTS.VIEW_META_CHANGED, { view_id: 'saved-page', name: 'Renamed roadmap', layout: 0 });
    });
    expect(container.querySelector('.mention-content')?.textContent).toBe('Renamed roadmap');
    await act(async () => fireEvent.copy(editable, { clipboardData: clipboard }));
    expect(clipboard.getData('text/plain')).toBe('See Renamed roadmap');
    expect(context.loadViewMeta).toHaveBeenCalledTimes(1);
  });
  beforeEach(() => {
    clearPageNameCache();
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'time').mockImplementation(() => undefined);
    jest.spyOn(console, 'timeEnd').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    cleanup();
  });

  it('pastes the copied text, not an empty paragraph', async () => {
    const clipboard = await copyFromCell(withRichTextCell(withReact(withHistory(createEditor()))));

    expect(clipboard.getData('text/plain')).toBe('Hello world');
    expect(await pasteIntoDocument(clipboard)).toEqual(['Doc Hello world']);
  });

  it('does the same from the read-only display of a cell', async () => {
    const clipboard = await copyFromCell(withRichTextCellCopy(withReact(createEditor())), true);

    expect(await pasteIntoDocument(clipboard)).toEqual(['Doc Hello world']);
  });

  it.each(['copy', 'cut', 'read-only'])(
    'writes readable mention text on %s without duplicating its placeholder',
    async (action) => {
      const editor =
        action === 'read-only'
          ? withRichTextCellCopy(withReact(createEditor()))
          : withRichTextCell(withReact(withHistory(createEditor())));
      const delta = [
        { insert: 'Ask ' },
        { insert: '@', attributes: { mention: { type: MentionType.Person, person_id: 'ada', person_name: 'Ada' } } },
        { insert: ' now\nPlease', attributes: { bold: true } },
      ];
      const clipboard = await copyFromCell(editor, action === 'read-only', {
        initialValue: richTextToSlateValue(delta),
        cut: action === 'cut',
      });

      expect(clipboard.getData('text/plain')).toBe('Ask @Ada now\nPlease');
      const fragment = JSON.parse(decodeURIComponent(window.atob(clipboard.getData('application/x-slate-fragment'))));

      expect(slateValueToRichText(fragment)).toEqual(delta);
      if (action === 'cut') expect(Editor.string(editor, [])).toBe('');
    }
  );

  it('copies only the selected text and mention', async () => {
    const editor = withRichTextCell(withReact(withHistory(createEditor())));
    const clipboard = await copyFromCell(editor, false, {
      initialValue: richTextToSlateValue([
        { insert: 'Ask ' },
        { insert: '@', attributes: { mention: { type: MentionType.Person, person_id: 'ada', person_name: 'Ada' } } },
        { insert: ' now' },
      ]),
      selection: { anchor: { path: [0, 0], offset: 2 }, focus: { path: [0, 2], offset: 2 } },
    });

    expect(clipboard.getData('text/plain')).toBe('k @Ada n');
  });

  it('keeps a saved page label when copying a read-only cell without a cached name', async () => {
    let editor!: ReactEditor;
    const copy = richTextSlate.withRichTextCellCopy;

    jest.spyOn(richTextSlate, 'withRichTextCellCopy').mockImplementation((value, plainTextOf) => {
      editor = value;
      return copy(value, plainTextOf);
    });
    const { container } = render(
      <RichTextCellDocument
        rowId='row'
        lineClassName=''
        delta={[
          { insert: 'See ' },
          {
            insert: '@',
            attributes: { mention: { type: MentionType.PageRef, page_id: 'saved-page', label: 'Saved roadmap' } },
          },
        ]}
      />
    );
    const editable = container.querySelector('[data-slate-editor]')!;

    Object.defineProperty(editable, 'isContentEditable', { value: true });

    await act(async () => Transforms.select(editor, Editor.range(editor, [])));
    const clipboard = clipboardData();

    await act(async () => fireEvent.copy(editable, { clipboardData: clipboard }));
    expect(clipboard.getData('text/plain')).toBe('See Saved roadmap');
  });
});
