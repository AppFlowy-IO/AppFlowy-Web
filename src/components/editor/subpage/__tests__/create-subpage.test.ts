import { createEditor } from 'slate';
import * as Y from 'yjs';

import { CustomEditor } from '@/application/slate-yjs/command';
import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { initializeDocumentStructure } from '@/application/slate-yjs/utils/yjs';
import { BlockType, CollabOrigin, CreatePageResponse, YDoc } from '@/application/types';
import { EditorContextState } from '@/components/editor/EditorContext';

import { createSubpage } from '../create-subpage';

function setup() {
  const doc = new Y.Doc() as YDoc;
  initializeDocumentStructure(doc, true);
  const editor = withYHistory(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local }));
  editor.connect();
  editor.select(editor.start([0]));
  let complete!: (result: CreatePageResponse) => void;
  const request = new Promise<CreatePageResponse>((resolve) => {
    complete = resolve;
  });
  const context: EditorContextState = {
    viewId: 'parent',
    workspaceId: 'workspace',
    readOnly: false,
    addPage: jest.fn(() => request),
    deletePage: jest.fn().mockResolvedValue(undefined),
    openPageModal: jest.fn(),
  };
  return {
    editor,
    context,
    complete,
    dispose: () => {
      editor.disconnect();
      doc.destroy();
    },
  };
}

it('inserts at the original block when the selection changes while creating the child', async () => {
  const f = setup();
  try {
    const firstId = f.editor.children[0].blockId!;
    CustomEditor.addBelowBlock(f.editor, firstId, BlockType.Paragraph, {});
    f.editor.select(f.editor.start([0]));
    const pending = createSubpage(f.editor, f.context);
    f.editor.select(f.editor.start([1]));
    f.complete({ view_id: 'child' });
    await pending;
    expect(f.editor.children[0]).toMatchObject({ type: 'sub_page', data: { view_id: 'child' } });
    expect(f.editor.children[1]).toMatchObject({ type: 'paragraph' });
    expect(f.context.addPage).toHaveBeenCalledWith('parent', { layout: 0 });
    expect(f.context.openPageModal).toHaveBeenCalledWith('child');
  } finally {
    f.dispose();
  }
});

it.each(['deleted', 'disconnected', 'read-only'])(
  'cleans up the child if the insertion point becomes %s',
  async (reason) => {
    const f = setup();
    try {
      const id = f.editor.children[0].blockId!;
      const pending = createSubpage(f.editor, f.context);
      if (reason === 'deleted') CustomEditor.deleteBlock(f.editor, id);
      if (reason === 'disconnected') f.editor.disconnect();
      if (reason === 'read-only') f.editor.readOnly = true;
      f.complete({ view_id: 'child' });
      await pending;
      expect(f.context.deletePage).toHaveBeenCalledWith('child');
      expect(f.context.openPageModal).not.toHaveBeenCalled();
      expect(findSlateEntryByBlockId(f.editor, id)?.[0].type).not.toBe('sub_page');
    } finally {
      f.dispose();
    }
  }
);

it('ignores repeated clicks while creation is pending', async () => {
  const f = setup();
  try {
    const first = createSubpage(f.editor, f.context);
    await createSubpage(f.editor, f.context);
    f.complete({ view_id: 'child' });
    await first;
    expect(f.context.addPage).toHaveBeenCalledTimes(1);
  } finally {
    f.dispose();
  }
});

it('creates the child even when the host does not offer a modal', async () => {
  const f = setup();
  try {
    f.context.openPageModal = undefined;
    const pending = createSubpage(f.editor, f.context);
    f.complete({ view_id: 'child' });
    await pending;
    expect(f.editor.children[0]).toMatchObject({ type: 'sub_page', data: { view_id: 'child' } });
  } finally {
    f.dispose();
  }
});
