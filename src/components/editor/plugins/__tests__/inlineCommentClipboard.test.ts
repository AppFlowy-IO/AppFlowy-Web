import { createEditor, Node } from 'slate';
import { ReactEditor } from 'slate-react';

import { BlockType } from '@/application/types';

import { withCopy } from '../withCopy';
import { withInsertData } from '../withInsertData';

jest.mock('@/application/slate-yjs/utils/editor', () => ({
  ...jest.requireActual('@/application/slate-yjs/utils/editor'),
  isInsideSimpleTableCell: jest.fn(() => false),
}));

const fragment: Node[] = [
  {
    type: BlockType.Paragraph,
    blockId: 'block-1',
    children: [{ text: 'selected', bold: true, 'comment-ids': ['comment-1'] }],
  },
];

function clipboardData(values: Record<string, string> = {}) {
  const data = new Map(Object.entries(values));

  return {
    files: [],
    getData: (type: string) => data.get(type) ?? '',
    setData: (type: string, value: string) => data.set(type, value),
  } as unknown as DataTransfer;
}

function encodeSlateFragment(nodes: Node[]): string {
  return window.btoa(encodeURIComponent(JSON.stringify(nodes)));
}

describe('inline comment clipboard boundaries', () => {
  it('strips comment ids before the Slate copy serializer reads the fragment', () => {
    const editor = createEditor() as ReactEditor;
    const serializedFragments: Node[][] = [];

    editor.children = fragment;
    editor.selection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 8 },
    };
    editor.getFragment = () => fragment;
    editor.setFragmentData = () => serializedFragments.push(editor.getFragment());

    withCopy(editor).setFragmentData(clipboardData());

    expect(serializedFragments).toEqual([
      [
        {
          type: BlockType.Paragraph,
          blockId: 'block-1',
          children: [{ text: 'selected', bold: true }],
        },
      ],
    ]);
  });

  it('strips comment ids from a Slate fragment before inserting it', () => {
    const editor = createEditor() as ReactEditor;
    const insertFragment = jest.fn();

    editor.children = [
      {
        type: BlockType.Paragraph,
        blockId: 'target-block',
        children: [{ text: '' }],
      },
    ];
    editor.selection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    };
    editor.insertFragment = insertFragment;
    withInsertData(editor).insertData(
      clipboardData({
        'application/x-slate-fragment': encodeSlateFragment([{ text: 'selected', bold: true, 'comment-ids': ['comment-1'] }]),
      })
    );

    expect(insertFragment).toHaveBeenCalledWith([{ text: 'selected', bold: true }]);
  });
});
