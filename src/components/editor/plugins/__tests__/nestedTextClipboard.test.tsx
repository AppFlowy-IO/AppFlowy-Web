import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createEditor, Element, Node, Range, Text } from 'slate';
import { Editable, RenderElementProps, Slate, withReact } from 'slate-react';

import { withYjs, YjsEditor } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';

import { clipboardFormatKey, withCopy } from '../withCopy';
import { withInsertData } from '../withInsertData';
import { withPasted } from '../withPasted';

jest.mock('@/components/editor/parsers/html-parser', () => ({ parseHTML: jest.fn() }));
jest.mock('@/components/editor/parsers/markdown-parser', () => ({ parseMarkdown: jest.fn() }));

const sentence = 'En essay/report ser más objetivo con el lenguaje';
const prefix = 'Before ';
const suffix = ' after';

function block(type: BlockType, text: string | Text[], children: Element[] = [], data = {}): Element {
  return {
    type,
    data,
    children: [{ type: YjsEditorKey.text, children: typeof text === 'string' ? [{ text }] : text }, ...children],
  } as Element;
}

function nestedDocument(children: Element[]): Element[] {
  return [
    block(
      BlockType.HeadingBlock,
      'Subtemas',
      [
        block(
          BlockType.HeadingBlock,
          'Writing',
          [block(BlockType.ToggleListBlock, 'Pautas generales', [block(BlockType.ToggleListBlock, '', children)])],
          { level: 2, toggle: true }
        ),
      ],
      { level: 1, toggle: true }
    ),
    block(BlockType.Paragraph, ''),
  ];
}

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

function readFragment(data: DataTransfer): Node[] {
  return JSON.parse(decodeURIComponent(window.atob(data.getData(`application/${clipboardFormatKey}`)))) as Node[];
}

function renderElement({ attributes, children }: RenderElementProps) {
  return <div {...attributes}>{children}</div>;
}

describe('nested text clipboard selections (AppFlowy #9016)', () => {
  const editors: YjsEditor[] = [];

  beforeEach(() => {
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'time').mockImplementation(() => undefined);
    jest.spyOn(console, 'timeEnd').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    for (const editor of editors.splice(0)) {
      editor.disconnect();
      editor.sharedRoot.doc?.destroy();
    }

    jest.restoreAllMocks();
  });

  function setup(nodes: Element[]) {
    const doc = withTestingYDoc('clipboard-page');

    slateContentInsertToYData('clipboard-page', 0, nodes, doc);

    const editor = withInsertData(
      withPasted(
        withCopy(
          withReact(
            withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local }),
            clipboardFormatKey
          )
        )
      )
    ) as YjsEditor;

    editor.connect();
    editors.push(editor);

    const view = render(
      <Slate editor={editor} initialValue={editor.children}>
        <Editable renderElement={renderElement} scrollSelectionIntoView={() => undefined} />
      </Slate>
    );

    const editable = view.getByRole('textbox');

    // JSDOM does not implement this DOM property, which Slate checks for clipboard events.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    return { editor, doc, editable };
  }

  async function select(editor: YjsEditor, selection: Range) {
    await act(async () => {
      editor.select(selection);
    });
  }

  it.each([
    { operation: 'copy', backward: false, htmlOnly: false, partial: false },
    { operation: 'copy', backward: true, htmlOnly: true, partial: true },
    { operation: 'cut', backward: false, htmlOnly: true, partial: false },
    { operation: 'cut', backward: true, htmlOnly: false, partial: true },
  ] as const)(
    '$operation nested text (backward=$backward, HTML-only=$htmlOnly, partial=$partial) without copying its ancestors',
    async ({ operation, backward, htmlOnly, partial }) => {
      const before = partial ? prefix : '';
      const after = partial ? suffix : '';
      const { editor, doc, editable } = setup(
        nestedDocument([
          block(BlockType.NumberedListBlock, [
            {
              text: `${before}${sentence}${after}`,
              bold: true,
              'comment-ids': ['source-thread'],
            },
          ]),
        ])
      );
      const path = [0, 1, 1, 1, 1, 0, 0];
      const start = { path, offset: before.length };
      const end = { path, offset: before.length + sentence.length };
      const originalGetFragment = editor.getFragment;

      await select(editor, backward ? { anchor: end, focus: start } : { anchor: start, focus: end });

      const clipboard = clipboardData();

      await act(async () => {
        fireEvent[operation](editable, { clipboardData: clipboard });
      });
      expect(editor.getFragment).toBe(originalGetFragment);
      expect(clipboard.getData('text/plain')).toBe(sentence);

      const fragment = readFragment(clipboard);
      const html = new DOMParser().parseFromString(clipboard.getData('text/html'), 'text/html');
      const encodedHTMLFragment = html.querySelector('[data-slate-fragment]')?.getAttribute('data-slate-fragment');

      expect(encodedHTMLFragment).toBe(clipboard.getData(`application/${clipboardFormatKey}`));
      expect(fragment).toEqual([
        expect.objectContaining({
          type: BlockType.NumberedListBlock,
          children: [
            expect.objectContaining({
              type: YjsEditorKey.text,
              children: [{ text: sentence, bold: true }],
            }),
          ],
        }),
      ]);
      expect(Node.string(Node.get(editor, [0, 1, 1, 1, 1]))).toBe(
        operation === 'cut' ? `${before}${after}` : `${before}${sentence}${after}`
      );

      await select(editor, { anchor: { path: [1, 0, 0], offset: 0 }, focus: { path: [1, 0, 0], offset: 0 } });

      const pasteData = htmlOnly
        ? clipboardData({
            'text/html': clipboard.getData('text/html'),
            'text/plain': clipboard.getData('text/plain'),
          })
        : clipboard;

      await act(async () => {
        fireEvent.paste(editable, { clipboardData: pasteData });
        editor.flushLocalChanges();
      });

      const saved = yDocToSlateContent(doc);
      const pasted = saved.children[1] as Element;

      expect(pasted.type).toBe(BlockType.NumberedListBlock);
      expect(pasted.children).toHaveLength(1);
      expect(Node.string(pasted)).toBe(sentence);
      expect((pasted.children[0] as Element).children).toEqual([{ text: sentence, bold: true }]);
      expect(editor.children[1]).toEqual(pasted);
    }
  );

  it('copies selected sibling list items without their enclosing headings and toggles', async () => {
    const { editor, editable } = setup(
      nestedDocument([
        block(BlockType.NumberedListBlock, 'First item'),
        block(BlockType.NumberedListBlock, 'Second item'),
        block(BlockType.NumberedListBlock, 'Unselected item'),
      ])
    );

    await select(editor, {
      anchor: { path: [0, 1, 1, 1, 1, 0, 0], offset: 6 },
      focus: { path: [0, 1, 1, 1, 2, 0, 0], offset: 6 },
    });

    const clipboard = clipboardData();

    await act(async () => {
      fireEvent.copy(editable, { clipboardData: clipboard });
    });

    const fragment = readFragment(clipboard) as Element[];

    expect(fragment.map((node) => node.type)).toEqual([BlockType.NumberedListBlock, BlockType.NumberedListBlock]);
    expect(fragment.map(Node.string)).toEqual(['item', 'Second']);
    expect(fragment.every((node) => node.children.length === 1)).toBe(true);
  });

  it('preserves a selected parent, its children, and a deliberately selected empty heading', async () => {
    const { editor, editable } = setup(
      nestedDocument([
        block(BlockType.ToggleListBlock, 'Selected parent', [
          block(BlockType.HeadingBlock, '', [], { level: 2 }),
          block(BlockType.NumberedListBlock, 'Selected child'),
        ]),
      ])
    );

    await select(editor, {
      anchor: { path: [0, 1, 1, 1, 1, 0, 0], offset: 0 },
      focus: { path: [0, 1, 1, 1, 1, 2, 0, 0], offset: 14 },
    });

    const clipboard = clipboardData();

    await act(async () => {
      fireEvent.copy(editable, { clipboardData: clipboard });
    });

    const fragment = readFragment(clipboard) as Element[];

    expect(fragment).toHaveLength(1);
    expect(fragment[0].type).toBe(BlockType.ToggleListBlock);
    expect(fragment[0].children).toEqual([
      expect.objectContaining({ type: YjsEditorKey.text, children: [{ text: 'Selected parent' }] }),
      expect.objectContaining({
        type: BlockType.HeadingBlock,
        data: { level: 2 },
        children: [expect.objectContaining({ type: YjsEditorKey.text, children: [{ text: '' }] })],
      }),
      expect.objectContaining({ type: BlockType.NumberedListBlock }),
    ]);
    expect(Node.string(fragment[0].children[2])).toBe('Selected child');
  });

  it('keeps the hierarchy when copying a whole block, including its empty heading', async () => {
    const { editor, editable } = setup([
      block(
        BlockType.HeadingBlock,
        '',
        [block(BlockType.ToggleListBlock, 'Parent', [block(BlockType.NumberedListBlock, 'Child')])],
        { level: 1 }
      ),
      block(BlockType.Paragraph, ''),
    ]);
    const original = editor.children[0];

    await select(editor, editor.range([0]));

    const clipboard = clipboardData();

    await act(async () => {
      fireEvent.copy(editable, { clipboardData: clipboard });
    });
    expect(readFragment(clipboard)).toEqual([original]);
    expect(editor.children[0]).toEqual(original);
  });

  it('preserves table containers and copies multiple cells as tab-separated text', async () => {
    const table = {
      type: BlockType.SimpleTableBlock,
      children: [
        {
          type: BlockType.SimpleTableRowBlock,
          children: ['A', 'B'].map((text) => ({
            type: BlockType.SimpleTableCellBlock,
            children: [block(BlockType.Paragraph, text)],
          })),
        },
      ],
    } as Element;
    const { editor, editable } = setup([table, block(BlockType.Paragraph, '')]);

    await select(editor, {
      anchor: { path: [0, 0, 0, 0, 0, 0], offset: 0 },
      focus: { path: [0, 0, 1, 0, 0, 0], offset: 1 },
    });

    const clipboard = clipboardData();

    await act(async () => {
      fireEvent.copy(editable, { clipboardData: clipboard });
    });

    const fragment = readFragment(clipboard) as Element[];
    const row = fragment[0].children[0] as Element;

    expect(fragment[0].type).toBe(BlockType.SimpleTableBlock);
    expect(row.type).toBe(BlockType.SimpleTableRowBlock);
    expect(row.children.map((cell) => (cell as Element).type)).toEqual([
      BlockType.SimpleTableCellBlock,
      BlockType.SimpleTableCellBlock,
    ]);
    expect(clipboard.getData('text/plain')).toBe('A\tB');
  });
});
