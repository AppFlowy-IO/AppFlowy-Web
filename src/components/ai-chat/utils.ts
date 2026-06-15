import { EditorData, EditorNode } from '@appflowyinc/editor';

import {
  createBlock, executeOperations, getBlockIndex,
  getBlocks,
  getChildrenArray,
  getChildrenMap,
  getDocument, getPageId, getParent, getText, getTextMap, updateBlockParent,
} from '@/application/slate-yjs/utils/yjs';
import {
  BlockType,
  YDoc,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';

export function insertDataToDoc(doc: YDoc, insertData: EditorData) {
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;

  executeOperations(sharedRoot, [() => {
    const document = getDocument(sharedRoot);

    if(!document) return;

    const blocks = getBlocks(sharedRoot);
    const pageId = getPageId(sharedRoot);
    const textMap = getTextMap(sharedRoot);
    const childrenMap = getChildrenMap(sharedRoot);

    if(!blocks || !textMap || !childrenMap) return;
    const traverse = (node: EditorNode, parentId: string) => {
      const block = createBlock(sharedRoot, {
        ty: node.type as unknown as BlockType,
        data: node.data as object,
      });

      const parent = blocks.get(parentId);

      const parentChildren = getChildrenArray(parent.get(YjsEditorKey.block_children), sharedRoot);
      const index = parentChildren.toArray().length;

      const blockText = getText(block.get(YjsEditorKey.block_external_id), sharedRoot);

      if(blockText && node.delta && node.delta.length > 0) {
        blockText.applyDelta(node.delta);
      }

      updateBlockParent(sharedRoot, block, parent, index);

      if(node.children) {
        node.children.forEach(child => {
          traverse(child, block.get(YjsEditorKey.block_id));
        });
      }
    };

    insertData.forEach(node => {
      traverse(node, pageId);
    });
  }], 'AIChatInsertContent');

}

export function insertDataAfterBlock(sharedRoot: YSharedRoot, insertData: EditorData, blockId: string) {
  let latestBlockId = '';

  executeOperations(sharedRoot, [() => {
    const document = getDocument(sharedRoot);

    if(!document) return;

    const blocks = getBlocks(sharedRoot);
    const textMap = getTextMap(sharedRoot);
    const childrenMap = getChildrenMap(sharedRoot);

    if(!blocks || !textMap || !childrenMap) return;
    const traverse = (node: EditorNode, parentId: string, index: number) => {
      const block = createBlock(sharedRoot, {
        ty: node.type as unknown as BlockType,
        data: node.data as object,
      });

      const parent = blocks.get(parentId);

      const blockText = getText(block.get(YjsEditorKey.block_external_id), sharedRoot);

      if(blockText && node.delta && node.delta.length > 0) {
        blockText.applyDelta(node.delta);
      }

      updateBlockParent(sharedRoot, block, parent, index);

      latestBlockId = block.get(YjsEditorKey.block_id);
      if(node.children) {
        node.children.forEach((child, index) => {
          traverse(child, block.get(YjsEditorKey.block_id), index);
        });
      }

    };

    const parent = getParent(blockId, sharedRoot);
    const index = getBlockIndex(blockId, sharedRoot);
    const parentId = parent?.get(YjsEditorKey.block_id);

    if(parentId) {
      insertData.forEach((node, i) => {
        traverse(node, parentId, index + i + 1);
      });
    }

  }], 'AIInsertAfterContent');

  return latestBlockId;
}


