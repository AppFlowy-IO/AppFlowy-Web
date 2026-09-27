import { createEditor, Element, Node } from 'slate';

import { withYjs } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';
import { createDatabaseDuplicatePlaceholderData } from '@/components/editor/components/blocks/database/utils/databaseBlockUtils';
import { EditorContextState } from '@/components/editor/EditorContext';
import { observeSubpageLifecycle } from '@/components/editor/subpage/subpage-lifecycle';
import { collectInlineCommentAnchors } from '@/components/inline-comment/editor/anchors';

import { duplicateBlockSelection, finalizeDuplicatedBlockData } from '../duplicateBlockSelection';

const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

function block(type: BlockType, text = '', children: Element[] = [], data = {}): Element {
  return { type, data, children: [{ type: YjsEditorKey.text, children: [{ text }] }, ...children] } as Element;
}

function setup(nodes: Element[]) {
  const doc = withTestingYDoc('parent');
  slateContentInsertToYData('parent', 0, nodes, doc);
  const editor = withYHistory(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local }));
  editor.connect();
  const context: EditorContextState = {
    workspaceId: 'workspace',
    viewId: 'parent',
    readOnly: false,
    duplicatePage: jest.fn(async (id, options) => {
      options?.onDuplicated?.(`${id}-copy`);
    }),
    deletePage: jest.fn().mockResolvedValue(undefined),
    restorePage: jest.fn().mockResolvedValue(undefined),
    loadViewMeta: jest.fn().mockResolvedValue({ parent_view_id: 'parent' }),
  };
  const stop = observeSubpageLifecycle(
    editor,
    () => context,
    (error) => {
      throw error;
    }
  );
  return {
    editor,
    context,
    dispose: () => {
      stop();
      editor.disconnect();
      doc.destroy();
    },
  };
}

it('duplicates a selection with multiple subpages in one undo entry, including its owned pages', async () => {
  const f = setup([
    block(BlockType.SubpageBlock, '', [], { view_id: 'first' }),
    block(BlockType.Paragraph, 'Between pages'),
    block(BlockType.SubpageBlock, '', [], { view_id: 'second' }),
  ]);
  try {
    const originalIds = f.editor.children.map((node) => node.blockId!);
    const duplicated = await duplicateBlockSelection(f.editor, originalIds, f.context);
    expect(duplicated).toHaveLength(3);
    expect(f.editor.children).toHaveLength(6);
    expect(f.editor.children.slice(3).map((node) => node.type)).toEqual([
      BlockType.SubpageBlock,
      BlockType.Paragraph,
      BlockType.SubpageBlock,
    ]);
    expect(f.editor.undoManager.undoStack).toHaveLength(1);

    f.editor.undo();
    await settle();
    expect(f.editor.children.map((node) => node.blockId)).toEqual(originalIds);
    expect(f.context.deletePage).toHaveBeenCalledTimes(2);
    expect(f.context.deletePage).toHaveBeenCalledWith('first-copy');
    expect(f.context.deletePage).toHaveBeenCalledWith('second-copy');

    f.editor.redo();
    await settle();
    expect(f.editor.children).toHaveLength(6);
    expect(f.context.restorePage).toHaveBeenCalledWith('first-copy');
    expect(f.context.restorePage).toHaveBeenCalledWith('second-copy');
  } finally {
    f.dispose();
  }
});

it('preserves marks but leaves the original comment anchored only to the source container', async () => {
  const container = block(BlockType.CalloutBlock, 'Commented', [
    block(BlockType.SubpageBlock, '', [], { view_id: 'child' }),
  ]);
  (container.children[0] as Element).children = [{ text: 'Commented', bold: true, 'comment-ids': ['thread'] }];
  const f = setup([container]);
  try {
    const before = collectInlineCommentAnchors(f.editor).get('thread');
    expect(before?.quotedText).toBe('Commented');
    await duplicateBlockSelection(f.editor, [f.editor.children[0].blockId!], f.context);
    expect(collectInlineCommentAnchors(f.editor).get('thread')).toEqual(before);
    const copy = f.editor.children[1];
    expect(Node.string(copy)).toBe('Commented');
    expect((copy.children[0] as Element).children).toEqual([{ text: 'Commented', bold: true }]);
    expect((copy.children[1] as Element).data).toMatchObject({ view_id: 'child-copy' });
    expect((f.editor.children[0].children[0] as Element).children[0]).toMatchObject({ 'comment-ids': ['thread'] });
  } finally {
    f.dispose();
  }
});

it('keeps edits made during preparation outside the duplication undo entry', async () => {
  const f = setup([
    block(BlockType.Paragraph, 'Existing'),
    block(BlockType.SubpageBlock, '', [], { view_id: 'first' }),
    block(BlockType.SubpageBlock, '', [], { view_id: 'second' }),
  ]);
  let finish!: () => void;
  (f.context.duplicatePage as jest.Mock).mockImplementation(async (id, options) => {
    if (id === 'second')
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    options.onDuplicated(`${id}-copy`);
  });
  try {
    const originalIds = f.editor.children.map((node) => node.blockId!);
    const pending = duplicateBlockSelection(f.editor, originalIds.slice(1), f.context);
    await settle();
    expect(f.editor.children).toHaveLength(3);
    f.editor.select(f.editor.end([0]));
    f.editor.insertText(' edit');
    f.editor.flushLocalChanges();
    finish();
    await pending;
    expect(f.editor.children).toHaveLength(5);
    expect(f.editor.undoManager.undoStack).toHaveLength(2);

    f.editor.undo();
    await settle();
    expect(f.editor.children.map((node) => node.blockId)).toEqual(originalIds);
    expect(Node.string(f.editor.children[0])).toBe('Existing edit');
    expect(f.context.deletePage).toHaveBeenCalledTimes(2);
  } finally {
    f.dispose();
  }
});

it('cleans up earlier page copies without inserting a partial selection when preparation fails', async () => {
  const f = setup([
    block(BlockType.SubpageBlock, '', [], { view_id: 'first' }),
    block(BlockType.SubpageBlock, '', [], { view_id: 'second' }),
  ]);
  try {
    (f.context.duplicatePage as jest.Mock)
      .mockImplementationOnce(async (_, options) => options.onDuplicated('first-copy'))
      .mockRejectedValueOnce(new Error('Copy failed'));
    await expect(
      duplicateBlockSelection(
        f.editor,
        f.editor.children.map((node) => node.blockId!),
        f.context
      )
    ).rejects.toThrow('Copy failed');
    expect(f.editor.children).toHaveLength(2);
    expect(f.editor.undoManager.undoStack).toHaveLength(0);
    expect(f.context.deletePage).toHaveBeenCalledWith('first-copy');
  } finally {
    f.dispose();
  }
});

it.each([false, true])(
  'keeps resolved database duplicates in the original undo entry (intervening edit: %s)',
  async (edit) => {
    const f = setup([
      block(BlockType.Paragraph, 'Original'),
      block(BlockType.GridBlock, '', [], { parent_id: 'parent', view_ids: ['source-view'], database_id: 'source-db' }),
      block(BlockType.SubpageBlock, '', [], { view_id: 'child' }),
    ]);
    const finalData = { parent_id: 'parent', view_ids: ['copy-view'], database_id: 'copy-db' };
    try {
      const selectedIds = f.editor.children.slice(1).map((node) => node.blockId!);
      const copies = await duplicateBlockSelection(f.editor, selectedIds, f.context, (source) =>
        source.type === BlockType.GridBlock ? createDatabaseDuplicatePlaceholderData('parent') : undefined
      );
      if (edit) {
        f.editor.select(f.editor.end([0]));
        f.editor.insertText(' edit');
        f.editor.flushLocalChanges();
      }
      expect(finalizeDuplicatedBlockData(f.editor, copies[0].blockId, finalData)).toBe(true);
      expect(f.editor.children[3].data).toEqual(finalData);
      expect(f.editor.undoManager.undoStack).toHaveLength(edit ? 2 : 1);

      if (edit) {
        f.editor.undo();
        expect(Node.string(f.editor.children[0])).toBe('Original');
        expect(f.editor.children).toHaveLength(5);
      }
      f.editor.undo();
      await settle();
      expect(f.editor.children).toHaveLength(3);
      expect(f.context.deletePage).toHaveBeenCalledWith('child-copy');

      f.editor.redo();
      await settle();
      expect(f.editor.children).toHaveLength(5);
      expect(f.editor.children[3].data).toEqual(finalData);
      expect(f.context.restorePage).toHaveBeenCalledWith('child-copy');
    } finally {
      f.dispose();
    }
  }
);
