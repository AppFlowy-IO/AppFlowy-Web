import { createEditor, Element, Transforms } from 'slate';

import { withYjs } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { CustomEditor } from '@/application/slate-yjs/command';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';

import { captureBlockCreationTarget, captureExistingDatabaseBlock } from '../block-creation-target';

function setup() {
  const doc = withTestingYDoc('document');
  const paragraph = {
    type: BlockType.Paragraph,
    data: {},
    children: [{ type: YjsEditorKey.text, children: [{ text: '' }] }],
  } as Element;

  slateContentInsertToYData('document', 0, [paragraph], doc);
  const editor = withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local });

  editor.connect();
  const blockId = editor.children[0].blockId!;

  return {
    editor,
    blockId,
    dispose: () => {
      editor.disconnect();
      doc.destroy();
    },
  };
}

it('follows the intentional paragraph replacement through receipt completion', () => {
  const f = setup();

  try {
    const target = captureBlockCreationTarget(f.editor, f.blockId);

    target.replace((id) =>
      CustomEditor.turnToBlock(f.editor, id, BlockType.GridBlock, {
        parent_id: 'document',
        view_ids: ['created'],
        database_id: 'database',
      })
    );
    expect(findSlateEntryByBlockId(f.editor, f.blockId)).toBeUndefined();
    expect(f.editor.children[0].data).toMatchObject({ view_ids: ['created'] });
    expect(target.assertCurrent).not.toThrow();
    CustomEditor.deleteBlock(f.editor, f.editor.children[0].blockId!);
    expect(target.assertCurrent).toThrow('no longer editable');
  } finally {
    f.dispose();
  }
});

it.each(['deleted', 'replaced', 'read-only', 'disconnected', 'first-body', 'root-changed'] as const)(
  'rejects a %s target after asynchronous preparation',
  async (change) => {
    const f = setup();
    const originalRoot = f.editor.sharedRoot;

    try {
      const target = captureBlockCreationTarget(f.editor, f.blockId);

      await Promise.resolve();
      if (change === 'deleted') CustomEditor.deleteBlock(f.editor, f.blockId);
      if (change === 'replaced') CustomEditor.turnToBlock(f.editor, f.blockId, BlockType.GridBlock, {});
      if (change === 'read-only') f.editor.readOnly = true;
      if (change === 'disconnected') f.editor.disconnect();
      if (change === 'first-body') f.editor.firstBody = {} as NonNullable<typeof f.editor.firstBody>;
      if (change === 'root-changed') f.editor.sharedRoot = originalRoot.clone();
      const replace = jest.fn();

      expect(() => target.replace(replace)).toThrow('no longer editable');
      expect(replace).not.toHaveBeenCalled();
    } finally {
      f.editor.sharedRoot = originalRoot;
      f.editor.firstBody = undefined;
      f.dispose();
    }
  }
);

it('rejects an unsuccessful replacement instead of completing its receipt', () => {
  const f = setup();

  try {
    const target = captureBlockCreationTarget(f.editor, f.blockId);

    expect(() => target.replace(() => undefined)).toThrow('insertion block is unavailable');
    expect(target.assertCurrent).not.toThrow();
  } finally {
    f.dispose();
  }
});

it.each([{ view_ids: ['created'] }, { view_ids: [], view_id: 'created' }, { view_id: 'created' }])(
  'matches existing and legacy view references, then guards its exact block (%j)',
  (reference) => {
    const f = setup();

    try {
      CustomEditor.turnToBlock(f.editor, f.blockId, BlockType.GridBlock, {
        parent_id: 'document',
        database_id: 'database',
        ...reference,
      });
      expect(captureExistingDatabaseBlock(f.editor, 'other-parent', 'database', 'created')).toBeUndefined();
      expect(captureExistingDatabaseBlock(f.editor, 'document', 'other-database', 'created')).toBeUndefined();
      expect(captureExistingDatabaseBlock(f.editor, 'document', 'database', 'other-view')).toBeUndefined();
      const witness = captureExistingDatabaseBlock(f.editor, 'document', 'database', 'created');

      expect(witness).toBeDefined();
      expect(witness).not.toThrow();
      Transforms.setNodes(
        f.editor,
        { data: { parent_id: 'document', database_id: 'database', view_ids: ['replacement'] } },
        { at: [0] }
      );
      expect(witness).toThrow('Previously activated Database block changed');
    } finally {
      f.dispose();
    }
  }
);
