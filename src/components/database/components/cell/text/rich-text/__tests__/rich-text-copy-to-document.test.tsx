import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createEditor, Editor, Element, Node, Transforms } from 'slate';
import { withHistory } from 'slate-history';
import { Editable, RenderElementProps, Slate, withReact } from 'slate-react';

import { withYjs, YjsEditor } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';
import { clipboardFormatKey, withCopy } from '@/components/editor/plugins/withCopy';
import { withInsertData } from '@/components/editor/plugins/withInsertData';
import { withPasted } from '@/components/editor/plugins/withPasted';

import { richTextToSlateValue, withRichTextCell, withRichTextCellCopy } from '../rich-text-slate';

jest.mock('@/components/editor/parsers/html-parser', () => ({ parseHTML: jest.fn(() => []) }));
jest.mock('@/components/editor/parsers/markdown-parser', () => ({ parseMarkdown: jest.fn(() => []) }));

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
async function copyFromCell(editor: Editor, readOnly = false) {
  const view = render(
    <Slate editor={editor} initialValue={formatted}>
      <Editable data-testid='cell' readOnly={readOnly} renderElement={renderElement} />
    </Slate>
  );
  const editable = view.getByTestId('cell');

  Object.defineProperty(editable, 'isContentEditable', { value: true });
  await act(async () => {
    Transforms.select(editor, Editor.range(editor, []));
  });

  const clipboard = clipboardData();

  await act(async () => {
    fireEvent.copy(editable, { clipboardData: clipboard });
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
  beforeEach(() => {
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
});
