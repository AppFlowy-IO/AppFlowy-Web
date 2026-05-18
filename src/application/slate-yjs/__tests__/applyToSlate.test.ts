import { describe, expect, it, jest } from '@jest/globals';
import { createEditor } from 'slate';

jest.unmock('lodash-es/isEqual');

import { YjsEditor } from '@/application/slate-yjs';
import {
  getTestingDocData,
  insertBlock,
  withTestingYDoc,
  withTestingYjsEditor,
} from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { createBlock } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YjsEditorKey } from '@/application/types';

const REMOTE_ORIGIN = 'remote';

describe('translateYEvents', () => {
  it('should apply remote block type updates to the matching block id', () => {
    const doc = withTestingYDoc('page-id');
    const insertedId = 'inserted-id';
    const targetId = 'target-id';

    insertBlock({
      doc,
      blockObject: {
        id: insertedId,
        ty: BlockType.Paragraph,
        relation_id: insertedId,
        text_id: insertedId,
        data: '{}',
      },
    }).applyDelta([{ insert: 'Inserted sibling' }]);

    insertBlock({
      doc,
      prevBlockId: insertedId,
      blockObject: {
        id: targetId,
        ty: BlockType.Paragraph,
        relation_id: targetId,
        text_id: targetId,
        data: '{}',
      },
    }).applyDelta([{ insert: 'Target block' }]);

    const editor = withTestingYjsEditor(createEditor(), doc);

    YjsEditor.connect(editor);

    try {
      expect((editor.children as Array<{ blockId: string }>).map((child) => child.blockId)).toEqual([
        insertedId,
        targetId,
      ]);

      const { blocks } = getTestingDocData(doc);
      const targetBlock = blocks.get(targetId);

      if (!targetBlock) {
        throw new Error(`Target block ${targetId} not found`);
      }

      // Remote type updates do not carry a trustworthy Slate path. The Yjs
      // event path gives us the stable block id, so the second block must be
      // updated even though the first block is still at root path [0].
      doc.transact(() => {
        targetBlock.set(YjsEditorKey.block_type, BlockType.HeadingBlock);
        targetBlock.set(YjsEditorKey.block_data, JSON.stringify({ level: 2 }));
      }, REMOTE_ORIGIN);

      expect(editor.children).toHaveLength(2);
      expect(editor.children[0]).toMatchObject({
        blockId: insertedId,
        type: BlockType.Paragraph,
        data: {},
      });
      expect(editor.children[1]).toMatchObject({
        blockId: targetId,
        type: BlockType.HeadingBlock,
        data: { level: 2 },
      });
    } finally {
      YjsEditor.disconnect(editor);
    }
  });

  it('should skip remote block type updates when the block id is not rendered in Slate', () => {
    const doc = withTestingYDoc('page-id');
    const visibleId = 'visible-id';

    insertBlock({
      doc,
      blockObject: {
        id: visibleId,
        ty: BlockType.Paragraph,
        relation_id: visibleId,
        text_id: visibleId,
        data: '{}',
      },
    }).applyDelta([{ insert: 'Visible block' }]);

    const { sharedRoot } = getTestingDocData(doc);
    const orphanBlock = createBlock(sharedRoot, {
      ty: BlockType.Paragraph,
      data: {},
    });
    const editor = withTestingYjsEditor(createEditor(), doc);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    YjsEditor.connect(editor);

    try {
      // If the stable block id cannot be found in Slate, the remote update
      // should be ignored. Applying it to a fallback path would mutate the
      // visible sibling and recreate the stale-path bug.
      doc.transact(() => {
        orphanBlock.set(YjsEditorKey.block_type, BlockType.HeadingBlock);
        orphanBlock.set(YjsEditorKey.block_data, JSON.stringify({ level: 3 }));
      }, REMOTE_ORIGIN);

      expect(editor.children).toHaveLength(1);
      expect(editor.children[0]).toMatchObject({
        blockId: visibleId,
        type: BlockType.Paragraph,
        data: {},
      });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Block node not found in Slate editor'), {
        availableBlocks: [visibleId],
      });
    } finally {
      YjsEditor.disconnect(editor);
      errorSpy.mockRestore();
    }
  });
});
