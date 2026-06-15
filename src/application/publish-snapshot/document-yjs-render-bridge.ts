import { Descendant, Element, Text } from 'slate';
import * as Y from 'yjs';

import { slateNodeToDeltaInsert } from '@/application/slate-yjs/utils/convert';
import {
  generateBlockId,
  getChildrenArray,
  getDocument,
  getPageId,
  getTextMap,
  initializeDocumentStructure,
} from '@/application/slate-yjs/utils/yjs';
import {
  BlockType,
  YBlock,
  YBlocks,
  YChildrenMap,
  YDoc,
  YjsEditorKey,
  YMeta,
  YSharedRoot,
  YTextMap,
} from '@/application/types';

import type { PublishedDocumentRaw, PublishedDocumentSnapshot } from './types';

type PublishedSlateElement = Element & {
  blockId?: string;
  relationId?: string;
  data?: object;
};

type PublishedTextElement = Element & {
  textId?: string;
  children: Text[];
};

type TextDeltaInsert = {
  insert: string;
  attributes?: Record<string, unknown>;
};

function isPublishedTextElement(node: Descendant): node is PublishedTextElement {
  return Element.isElement(node) && node.type === YjsEditorKey.text;
}

function yTextFromSerializedDelta(serializedDelta: string): Y.Text {
  const text = new Y.Text();

  try {
    const delta = JSON.parse(serializedDelta) as Array<Partial<TextDeltaInsert>>;
    const validDelta = delta
      .filter((op): op is TextDeltaInsert => typeof op.insert === 'string')
      .map((op) => ({
        insert: op.insert,
        attributes: op.attributes,
      }));

    if (validDelta.length > 0) {
      text.applyDelta(validDelta);
    }
  } catch {
    // Invalid text deltas are treated as empty text so publish rendering can continue.
  }

  return text;
}

function createBlockFromSlateElement({
  element,
  parentId,
  sharedRoot,
}: {
  element: PublishedSlateElement;
  parentId: string;
  sharedRoot: YSharedRoot;
}): string {
  const document = getDocument(sharedRoot);
  const blocks = document.get(YjsEditorKey.blocks) as YBlocks;
  const meta = document.get(YjsEditorKey.meta) as Y.Map<unknown>;
  const childrenMap = meta.get(YjsEditorKey.children_map) as YChildrenMap;
  const textMap = getTextMap(sharedRoot);
  const blockId = element.blockId || generateBlockId();
  const relationId = element.relationId || blockId;
  const textElement = element.children.find(isPublishedTextElement);
  const childBlocks = element.children.filter((child): child is PublishedSlateElement => (
    Element.isElement(child) && child.type !== YjsEditorKey.text
  ));
  const block = new Y.Map() as YBlock;

  block.set(YjsEditorKey.block_id, blockId);
  block.set(YjsEditorKey.block_type, element.type as BlockType);
  block.set(YjsEditorKey.block_children, relationId);
  block.set(YjsEditorKey.block_data, JSON.stringify(element.data || {}));
  block.set(YjsEditorKey.block_parent, parentId);

  if (textElement) {
    const textId = textElement.textId || blockId;
    const yText = new Y.Text();
    const delta = textElement.children.filter(Text.isText).map(slateNodeToDeltaInsert);

    if (delta.length > 0) {
      yText.applyDelta(delta);
    }

    block.set(YjsEditorKey.block_external_id, textId);
    block.set(YjsEditorKey.block_external_type, YjsEditorKey.text);
    textMap.set(textId, yText);
  }

  blocks.set(blockId, block);
  childrenMap.set(relationId, new Y.Array());

  const childIds = childBlocks.map((child) =>
    createBlockFromSlateElement({
      element: child,
      parentId: blockId,
      sharedRoot,
    })
  );

  if (childIds.length > 0) {
    childrenMap.get(relationId)?.push(childIds);
  }

  return blockId;
}

export function createDocumentYjsRenderDocFromSnapshot(snapshot: PublishedDocumentSnapshot): YDoc {
  const doc = new Y.Doc({
    guid: snapshot.view.viewId,
  }) as YDoc;

  doc.object_id = snapshot.view.viewId;
  doc.view_id = snapshot.view.viewId;

  initializeDocumentStructure(doc, false, snapshot.view.viewId);

  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const pageId = getPageId(sharedRoot);
  const childIds = snapshot.document.children
    .filter((child): child is PublishedSlateElement => Element.isElement(child))
    .map((element) =>
      createBlockFromSlateElement({
        element,
        parentId: pageId,
        sharedRoot,
      })
    );

  if (childIds.length > 0) {
    getChildrenArray(pageId, sharedRoot)?.push(childIds);
  }

  return doc;
}

export function createDocumentYjsRenderDocFromRawData(documentId: string, raw: PublishedDocumentRaw): YDoc {
  const doc = new Y.Doc({
    guid: documentId,
  }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const document = new Y.Map<unknown>();
  const blocks = new Y.Map() as YBlocks;
  const meta = new Y.Map() as YMeta;
  const childrenMap = new Y.Map() as YChildrenMap;
  const textMap = new Y.Map() as YTextMap;

  doc.object_id = documentId;
  doc.view_id = documentId;

  Object.entries(raw.data.blocks).forEach(([blockId, rawBlock]) => {
    const block = new Y.Map() as YBlock;

    block.set(YjsEditorKey.block_id, rawBlock.id || blockId);
    block.set(YjsEditorKey.block_type, rawBlock.ty as BlockType);
    block.set(YjsEditorKey.block_children, rawBlock.children);
    block.set(YjsEditorKey.block_data, JSON.stringify(rawBlock.data || {}));

    if (rawBlock.parent !== undefined) {
      block.set(YjsEditorKey.block_parent, rawBlock.parent);
    }

    if (rawBlock.external_id) {
      block.set(YjsEditorKey.block_external_id, rawBlock.external_id);
    }

    if (rawBlock.external_type) {
      block.set(YjsEditorKey.block_external_type, rawBlock.external_type);
    }

    blocks.set(blockId, block);
  });

  Object.entries(raw.data.meta.children_map ?? {}).forEach(([childrenId, childIds]) => {
    const children = new Y.Array<string>();

    if (childIds.length > 0) {
      children.push(childIds);
    }

    childrenMap.set(childrenId, children);
  });

  Object.entries(raw.data.meta.text_map ?? {}).forEach(([textId, delta]) => {
    textMap.set(textId, yTextFromSerializedDelta(delta));
  });

  document.set(YjsEditorKey.page_id, raw.data.page_id);
  document.set(YjsEditorKey.blocks, blocks);
  document.set(YjsEditorKey.meta, meta);
  meta.set(YjsEditorKey.children_map, childrenMap);
  meta.set(YjsEditorKey.text_map, textMap);
  sharedRoot.set(YjsEditorKey.document, document);

  return doc;
}
