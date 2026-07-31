import { createEditor, Element, Text } from 'slate';
import { ReactEditor, withReact } from 'slate-react';

import { BlockType, MentionType } from '@/application/types';
import { withPasted } from '@/components/editor/plugins/withPasted';

jest.mock('@/components/editor/parsers/html-parser', () => ({
  parseHTML: jest.fn(),
}));

jest.mock('@/components/editor/parsers/markdown-parser', () => ({
  parseMarkdown: jest.fn(),
}));

jest.mock('@/application/slate-yjs/utils/editor', () => ({
  ...jest.requireActual('@/application/slate-yjs/utils/editor'),
  isInsideSimpleTableCell: jest.fn(() => false),
}));

const workspaceId = '3df0c6bb-417f-4f81-939a-c6114f160f9a';
const databaseViewId = '5d62b705-fee1-43c5-bd20-75a40aef254d';

function createPasteData(text: string): DataTransfer {
  return {
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  } as DataTransfer;
}

describe('withPasted', () => {
  it('pastes an internal database page URL as a page mention for the exact view', () => {
    const editor = withPasted(withReact(createEditor()) as ReactEditor);

    editor.children = [
      {
        type: BlockType.Paragraph,
        blockId: 'paragraph-1',
        children: [{ text: '' }],
      } as Element,
    ];
    editor.selection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    };

    const handled = editor.insertTextData(
      createPasteData(`http://localhost:3000/app/${workspaceId}/${databaseViewId}`)
    );

    expect(handled).toBe(true);
    const leaves = (editor.children[0] as Element).children as Text[];

    expect(leaves).toContainEqual({
      text: '@',
      mention: {
        type: MentionType.PageRef,
        page_id: databaseViewId,
      },
    });
  });
});
