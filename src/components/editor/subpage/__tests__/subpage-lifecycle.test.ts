import EventEmitter from 'events';

import { createEditor } from 'slate';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import { CustomEditor } from '@/application/slate-yjs/command';
import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { deleteBlock, initializeDocumentStructure } from '@/application/slate-yjs/utils/yjs';
import { BlockType, CollabOrigin, View, YDoc } from '@/application/types';
import { EditorContextState } from '@/components/editor/EditorContext';

import { observeSubpageLifecycle } from '../subpage-lifecycle';

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function setup(type = BlockType.SubpageBlock) {
  const doc = new Y.Doc() as YDoc;
  initializeDocumentStructure(doc, true);
  const editor = withYHistory(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local }));
  editor.connect();
  const id = CustomEditor.turnToBlock(editor, editor.children[0].blockId!, type, { view_id: 'child' })!;
  editor.undoManager.clear();
  const events = new EventEmitter();
  const context: EditorContextState = {
    viewId: 'parent',
    workspaceId: 'workspace',
    readOnly: false,
    eventEmitter: events,
    loadViewMeta: jest.fn().mockResolvedValue({ view_id: 'child', parent_view_id: 'parent' } as View),
    deletePage: jest.fn().mockResolvedValue(undefined),
    restorePage: jest.fn().mockResolvedValue(undefined),
  };
  const onError = jest.fn();
  const dispose = observeSubpageLifecycle(editor, () => context, onError);
  return {
    doc,
    editor,
    id,
    context,
    events,
    onError,
    dispose: () => {
      dispose();
      editor.disconnect();
      doc.destroy();
    },
  };
}

describe('owned subpage lifecycle', () => {
  it('trashes a removed child and restores it on undo, including repeated undo/redo', async () => {
    const f = setup();
    try {
      CustomEditor.deleteBlock(f.editor, f.id);
      await settle();
      expect(f.context.deletePage).toHaveBeenCalledWith('child');
      for (let i = 0; i < 2; i++) {
        f.editor.undo();
        await settle();
        expect(f.context.restorePage).toHaveBeenCalledTimes(i + 1);
        f.editor.redo();
        await settle();
        expect(f.context.deletePage).toHaveBeenCalledTimes(i + 2);
      }
    } finally {
      f.dispose();
    }
  });

  it('restores after undo while the delete request is still in flight', async () => {
    const f = setup();
    let finish!: () => void;
    (f.context.deletePage as jest.Mock).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    try {
      CustomEditor.deleteBlock(f.editor, f.id);
      await settle();
      f.editor.undo();
      await settle();
      expect(f.context.restorePage).not.toHaveBeenCalled();
      finish();
      await settle();
      expect(f.context.restorePage).toHaveBeenCalledWith('child');
    } finally {
      f.dispose();
    }
  });

  it.each([BlockType.LinkedPageBlock, BlockType.SubpageBlock])(
    'does not trash a %s removed by a remote edit',
    async (type) => {
      const f = setup(type);
      try {
        f.doc.transact(() => deleteBlock(f.editor.sharedRoot, f.id), CollabOrigin.Remote);
        await settle();
        expect(f.context.deletePage).not.toHaveBeenCalled();
      } finally {
        f.dispose();
      }
    }
  );

  it('removing a linked_page never deletes its referenced page', async () => {
    const f = setup(BlockType.LinkedPageBlock);
    try {
      CustomEditor.deleteBlock(f.editor, f.id);
      await settle();
      expect(f.context.deletePage).not.toHaveBeenCalled();
    } finally {
      f.dispose();
    }
  });

  it('keeps a child alive while another subpage block still references it', async () => {
    const f = setup();
    try {
      CustomEditor.duplicateBlock(f.editor, f.id);
      CustomEditor.deleteBlock(f.editor, f.id);
      await settle();
      expect(f.context.deletePage).not.toHaveBeenCalled();
    } finally {
      f.dispose();
    }
  });

  it('does not delete a page moved to another parent', async () => {
    const f = setup();
    (f.context.loadViewMeta as jest.Mock).mockResolvedValue({ view_id: 'child', parent_view_id: 'other' });
    try {
      CustomEditor.deleteBlock(f.editor, f.id);
      await settle();
      expect(f.context.deletePage).not.toHaveBeenCalled();
    } finally {
      f.dispose();
    }
  });

  it('removes moved or trashed subpages on explicit folder notifications without deleting them again', async () => {
    for (const event of ['move', 'outline', 'trash']) {
      const f = setup();
      try {
        if (event === 'move') f.events.emit(APP_EVENTS.VIEW_META_CHANGED, { view_id: 'child', parent_view_id: 'other' });
        else if (event === 'outline')
          f.events.emit(APP_EVENTS.OUTLINE_LOADED, [{ view_id: 'other', children: [{ view_id: 'child', parent_view_id: 'other' }] }]);
        else f.events.emit(APP_EVENTS.TRASH_UPDATED, { workspaceId: 'workspace', trashItems: [{ view_id: 'child' }] });
        await settle();
        expect(f.editor.children.some((node) => node.blockId === f.id)).toBe(false);
        expect(f.context.deletePage).not.toHaveBeenCalled();
        expect(f.editor.undoManager.undoStack).toHaveLength(0);
      } finally {
        f.dispose();
      }
    }
  });

  it('ignores missing outline entries and notifications for a different workspace', async () => {
    const f = setup();
    try {
      f.events.emit(APP_EVENTS.OUTLINE_LOADED, []);
      f.events.emit(APP_EVENTS.TRASH_UPDATED, { workspaceId: 'other', trashItems: [{ view_id: 'child' }] });
      await settle();
      expect(f.editor.children.some((node) => node.blockId === f.id)).toBe(true);
      expect(f.context.deletePage).not.toHaveBeenCalled();
    } finally {
      f.dispose();
    }
  });

  it('does not perform page operations once the editor becomes read-only', async () => {
    const f = setup();
    try {
      f.editor.readOnly = true;
      f.doc.transact(() => deleteBlock(f.editor.sharedRoot, f.id), CollabOrigin.LocalManual);
      await settle();
      expect(f.context.deletePage).not.toHaveBeenCalled();
    } finally {
      f.dispose();
    }
  });
});
