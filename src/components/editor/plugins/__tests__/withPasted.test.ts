import { createEditor, Element, Text } from 'slate';
import { ReactEditor, withReact } from 'slate-react';

import { BlockType, MentionType } from '@/application/types';
import { withPasted } from '@/components/editor/plugins/withPasted';
import { PASTE_AS_MENU_EVENT } from '@/components/editor/components/panels/paste-as-panel/constants';

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
const otherWorkspaceId = '8a412c3f-2b6d-49e0-9c11-52c1d86ffb01';
const databaseViewId = '5d62b705-fee1-43c5-bd20-75a40aef254d';
const databaseRowId = '439bd5d7-6b22-4117-8465-539dcc6c55d9';
const currentDocumentViewId = '0f1a2b3c-4d5e-4f60-8172-93a4b5c6d7e8';

function createPasteData(text: string): DataTransfer {
  return {
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  } as DataTransfer;
}

function createEditorWithEmptyParagraph(): ReactEditor {
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

  return editor;
}

function createEditorWithParagraph(text: string): ReactEditor {
  const editor = createEditorWithEmptyParagraph();

  editor.children = [
    {
      type: BlockType.Paragraph,
      blockId: 'paragraph-1',
      children: [{ text }],
    } as Element,
  ];
  editor.selection = {
    anchor: { path: [0, 0], offset: text.length },
    focus: { path: [0, 0], offset: text.length },
  };

  return editor;
}

function paragraphLeaves(editor: ReactEditor): Text[] {
  return (editor.children[0] as Element).children as Text[];
}

describe('withPasted', () => {
  beforeEach(() => {
    // Pasting happens inside a document of the current workspace.
    window.history.pushState({}, '', `/app/${workspaceId}/${currentDocumentViewId}`);
  });

  it('pastes an internal database page URL as a page mention for the exact view', () => {
    const editor = createEditorWithEmptyParagraph();

    const handled = editor.insertTextData(createPasteData(`http://localhost:3000/app/${workspaceId}/${databaseViewId}`));

    expect(handled).toBe(true);
    expect(paragraphLeaves(editor)).toContainEqual({
      text: '@',
      mention: {
        type: MentionType.PageRef,
        page_id: databaseViewId,
      },
    });
  });

  it('keeps a row deep link as a plain link so the row target is not dropped', () => {
    const editor = createEditorWithEmptyParagraph();
    const url = `http://localhost:3000/app/${workspaceId}/${databaseViewId}?r=${databaseRowId}`;

    const handled = editor.insertTextData(createPasteData(url));

    expect(handled).toBe(true);
    const leaves = paragraphLeaves(editor);

    expect(leaves.some((leaf) => 'mention' in leaf)).toBe(false);
    expect(leaves).toContainEqual({ text: url, href: url });
  });

  it('keeps the Paste as range attached to a URL inserted after existing text', () => {
    jest.useFakeTimers();
    const editor = createEditorWithParagraph('Inside a Project page (example: ');
    const url = `http://localhost:3000/app/${workspaceId}/${databaseViewId}?r=${databaseRowId}`;
    const dispatchEvent = jest.fn();
    const toDOMNode = jest.spyOn(ReactEditor, 'toDOMNode').mockReturnValue({ dispatchEvent } as unknown as HTMLElement);

    try {
      editor.insertTextData(createPasteData(url));
      jest.runOnlyPendingTimers();

      const event = dispatchEvent.mock.calls
        .map(([value]) => value as CustomEvent)
        .find((value) => value.type === PASTE_AS_MENU_EVENT);

      expect(event).toBeDefined();
      expect(editor.string(event?.detail.range)).toBe(url);
    } finally {
      toDOMNode.mockRestore();
      jest.useRealTimers();
    }
  });

  it('keeps a link into another workspace as a plain link instead of an unresolvable mention', () => {
    const editor = createEditorWithEmptyParagraph();
    const url = `http://localhost:3000/app/${otherWorkspaceId}/${databaseViewId}`;

    const handled = editor.insertTextData(createPasteData(url));

    expect(handled).toBe(true);
    const leaves = paragraphLeaves(editor);

    expect(leaves.some((leaf) => 'mention' in leaf)).toBe(false);
    expect(leaves).toContainEqual({ text: url, href: url });
  });
});
