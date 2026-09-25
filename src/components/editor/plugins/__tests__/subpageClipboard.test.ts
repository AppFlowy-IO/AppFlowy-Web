import { createEditor, Element, Node } from 'slate';
import { withReact } from 'slate-react';

import { withYjs } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { CustomEditor } from '@/application/slate-yjs/command';
import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { EditorContextState } from '@/components/editor/EditorContext';

import { withInsertData } from '../withInsertData';
import { withSubpages } from '../withSubpages';

jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));

const settle = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};

function block(type: BlockType, text = '', data = {}): Element {
  return { type, data, children: [{ type: YjsEditorKey.text, children: [{ text }] }] } as Element;
}

function clipboardData(nodes: Element[]): DataTransfer {
  return {
    files: [],
    getData: (type: string) =>
      type === 'application/x-appflowy-fragment' ? window.btoa(encodeURIComponent(JSON.stringify(nodes))) : '',
  } as unknown as DataTransfer;
}

function setup() {
  const doc = withTestingYDoc('parent');
  slateContentInsertToYData('parent', 0, [block(BlockType.Paragraph, 'AB')], doc);
  const context: EditorContextState = {
    workspaceId: 'workspace',
    viewId: 'parent',
    readOnly: false,
    duplicatePage: jest.fn(async (id, options) => {
      options?.onDuplicated?.(`${id}-copy`);
    }),
    restorePage: jest.fn().mockResolvedValue(undefined),
    loadTrashViews: jest.fn().mockResolvedValue([{ view_id: 'child', parent_view_id: 'source' }]),
    movePage: jest.fn().mockResolvedValue(undefined),
    deletePage: jest.fn().mockResolvedValue(undefined),
  };
  const editor = withSubpages(
    withInsertData(
      withReact(withYHistory(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local })))
    ),
    () => context
  ) as ReturnType<typeof withYHistory>;
  editor.connect();
  editor.select({ path: [0, 0, 0], offset: 1 });
  return {
    editor,
    context,
    dispose: () => {
      editor.disconnect();
      doc.destroy();
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it.each([BlockType.Paragraph, BlockType.HeadingBlock])(
  'merges leading %s text at the caret before a subpage',
  async (type) => {
    const f = setup();
    try {
      f.editor.insertData(clipboardData([block(type, 'X'), block(BlockType.SubpageBlock, '', { view_id: 'child' })]));
      await settle();
      expect(f.editor.children.map(Node.string)).toEqual(['AXB', '']);
      expect(f.editor.children[1]).toMatchObject({ type: BlockType.SubpageBlock, data: { view_id: 'child-copy' } });
      expect(yDocToSlateContent(f.editor.sharedRoot.doc!)?.children).toEqual(f.editor.children);
      expect(f.editor.undoManager.undoStack).toHaveLength(1);

      f.editor.undo();
      expect(f.editor.children.map(Node.string)).toEqual(['AB']);
      f.editor.redo();
      expect(f.editor.children.map(Node.string)).toEqual(['AXB', '']);
      expect(notify.error).not.toHaveBeenCalled();
    } finally {
      f.dispose();
    }
  }
);

it('preserves a leading code block when a mixed fragment includes a subpage', async () => {
  const f = setup();
  try {
    f.editor.insertData(
      clipboardData([block(BlockType.CodeBlock, 'X'), block(BlockType.SubpageBlock, '', { view_id: 'child' })])
    );
    await settle();
    expect(f.editor.children.map(Node.string)).toEqual(['AB', 'X', '']);
    expect(f.editor.children[1].type).toBe(BlockType.CodeBlock);
  } finally {
    f.dispose();
  }
});

it.each(['removed', 'unmounted', 'read-only'])(
  'rolls back cut-page moves when the insertion target is %s',
  async (reason) => {
    const f = setup();
    let finishMove!: () => void;
    (f.context.movePage as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishMove = resolve;
        })
    );
    try {
      f.editor.insertData(clipboardData([block(BlockType.SubpageBlock, '', { view_id: 'child', was_cut: true })]));
      await settle();
      expect(f.context.movePage).toHaveBeenCalledWith('child', 'parent');
      if (reason === 'removed') CustomEditor.deleteBlock(f.editor, f.editor.children[0].blockId!);
      if (reason === 'unmounted') f.editor.disconnect();
      if (reason === 'read-only') f.editor.readOnly = true;
      const undoCount = f.editor.undoManager.undoStack.length;
      finishMove();
      await settle();

      expect(f.context.movePage).toHaveBeenLastCalledWith('child', 'source');
      expect(f.context.deletePage).toHaveBeenCalledWith('child');
      expect(f.editor.children.every((node) => node.type !== BlockType.SubpageBlock)).toBe(true);
      expect(f.editor.undoManager.undoStack).toHaveLength(undoCount);
      expect(notify.error).not.toHaveBeenCalled();
    } finally {
      f.dispose();
    }
  }
);
