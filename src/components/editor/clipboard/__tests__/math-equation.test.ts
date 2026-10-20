import { createEditor, Node } from 'slate';
import { ReactEditor } from 'slate-react';

import { BlockType, YjsEditorKey } from '@/application/types';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';
import { parsedBlockToSlateElement } from '@/components/editor/parsers/parsed-block-to-slate';
import { withCopy } from '@/components/editor/plugins/withCopy';
import { withInsertData } from '@/components/editor/plugins/withInsertData';

import { mathFragmentText } from '../math-equation';

jest.mock('@/application/slate-yjs/utils/editor', () => ({
  ...jest.requireActual('@/application/slate-yjs/utils/editor'),
  isInsideSimpleTableCell: jest.fn(() => false),
}));

const fragment: Node[] = [
  {
    type: BlockType.Paragraph,
    blockId: 'paragraph',
    children: [
      { type: YjsEditorKey.text, children: [{ text: 'Before ' }, { text: '$', formula: 'x_1' }, { text: ' after' }] },
    ],
  },
  {
    type: BlockType.EquationBlock,
    blockId: 'math',
    data: { formula: '\\int_a^b f(x)dx' },
    children: [{ type: YjsEditorKey.text, children: [{ text: '' }] }],
  },
];

function clipboard() {
  const data = new Map<string, string>();

  return {
    files: [],
    getData: (type: string) => data.get(type) || '',
    setData: (type: string, value: string) => data.set(type, value),
  } as unknown as DataTransfer;
}

it('exports Flutter display math delimiters and round-trips inline and block TeX', () => {
  const source = mathFragmentText(fragment);

  expect(source).toBe('Before $x_1$ after\n$$\n\\int_a^b f(x)dx\n$$');
  const parsed = parseMarkdown(source!).map(parsedBlockToSlateElement);

  expect(parsed[0].children[0]).toMatchObject({
    children: [{ text: 'Before ' }, { text: '$', formula: 'x_1' }, { text: ' after' }],
  });
  expect(parsed[1]).toMatchObject({ type: BlockType.EquationBlock, data: { formula: '\\int_a^b f(x)dx' } });
  expect(mathFragmentText([{ text: 'ordinary text' }])).toBeNull();
});

it('keeps rich formula data when copying and pasting between editors, and exports readable plain text', () => {
  const editor = createEditor() as ReactEditor;
  const data = clipboard();

  editor.children = fragment;
  editor.select({ anchor: { path: [0, 0, 0], offset: 0 }, focus: { path: [1, 0, 0], offset: 0 } });
  editor.getFragment = () => fragment;
  editor.setFragmentData = (target) =>
    target.setData(
      'application/x-slate-fragment',
      window.btoa(encodeURIComponent(JSON.stringify(editor.getFragment())))
    );
  withCopy(editor).setFragmentData(data);
  expect(data.getData('text/plain')).toContain('$x_1$');
  expect(data.getData('text/plain')).toContain('$$\n\\int_a^b f(x)dx\n$$');
  const destination = createEditor() as ReactEditor;

  destination.children = [{ type: BlockType.Paragraph, blockId: 'destination', children: [{ text: '' }] }];
  destination.select({ path: [0, 0], offset: 0 });
  destination.insertFragment = jest.fn();
  withInsertData(destination).insertData(data);
  const pasted = (destination.insertFragment as jest.Mock).mock.calls[0][0] as Node[];

  expect(mathFragmentText(pasted)).toBe(mathFragmentText(fragment));
  expect(pasted).toHaveLength(2);
  expect(pasted[0]).toMatchObject({ blockId: expect.any(String) });
  expect(pasted[0]).not.toMatchObject({ blockId: 'paragraph' });
});
