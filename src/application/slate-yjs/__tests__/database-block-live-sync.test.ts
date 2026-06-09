import { expect } from '@jest/globals';
import { createEditor, Element } from 'slate';
import * as Y from 'yjs';

import { yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { BlockType, YBlocks, YjsEditorKey } from '@/application/types';

import {
  generateId,
  getTestingDocData,
  insertBlock,
  withTestingYDoc,
  withTestingYjsEditor,
} from './withTestingYjsEditor';

jest.mock('nanoid');
jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('lodash-es/isEqual', () => jest.requireActual('lodash/isEqual'));

function buildSyncedParagraph(blockId: string) {
  const pageId = generateId();
  const remoteDoc = withTestingYDoc(pageId);
  const remoteBlock = insertBlock({
    doc: remoteDoc,
    blockObject: {
      id: blockId,
      ty: BlockType.Paragraph,
      relation_id: blockId,
      text_id: blockId,
      data: '{}',
    },
  });

  remoteBlock.applyDelta([{ insert: '/grid' }]);

  const localDoc = new Y.Doc();

  Y.applyUpdateV2(localDoc, Y.encodeStateAsUpdateV2(remoteDoc));

  return { remoteDoc, localDoc };
}

function shipRemoteBlockUpdate(remoteDoc: Y.Doc, localDoc: Y.Doc, blockId: string) {
  const before = Y.encodeStateVector(localDoc);
  const { blocks } = getTestingDocData(remoteDoc);
  const block = (blocks as YBlocks).get(blockId);
  const viewId = generateId();
  const databaseId = generateId();

  expect(block).toBeDefined();

  block.set(YjsEditorKey.block_type, BlockType.GridBlock);
  block.set(YjsEditorKey.block_external_id, '');
  block.set(
    YjsEditorKey.block_data,
    JSON.stringify({
      view_id: viewId,
      view_ids: [viewId],
      database_id: databaseId,
      parent_id: blockId,
    })
  );

  Y.applyUpdateV2(localDoc, Y.encodeStateAsUpdateV2(remoteDoc, before));
}

describe('database block live sync', () => {
  it('updates an existing paragraph into a grid block when the remote block type changes', () => {
    const blockId = generateId();
    const { remoteDoc, localDoc } = buildSyncedParagraph(blockId);
    const editor = withTestingYjsEditor(createEditor(), localDoc);

    editor.connect();

    const initialNode = editor.children[0] as Element;

    expect(initialNode.type).toBe(BlockType.Paragraph);

    shipRemoteBlockUpdate(remoteDoc, localDoc, blockId);

    const fullRebuildNode = yDocToSlateContent(localDoc)?.children[0] as Element;

    expect(fullRebuildNode.type).toBe(BlockType.GridBlock);

    const liveNode = editor.children[0] as Element;

    expect(liveNode.type).toBe(BlockType.GridBlock);
    expect(liveNode.data).toEqual(fullRebuildNode.data);
    expect(liveNode.children).toEqual(fullRebuildNode.children);
  });
});
