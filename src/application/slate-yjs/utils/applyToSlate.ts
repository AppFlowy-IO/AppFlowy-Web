import isEqual from 'lodash-es/isEqual';
import { Editor, Element } from 'slate';
import { YEvent, YMapEvent, YTextEvent } from 'yjs';

import { YjsEditor } from '@/application/slate-yjs';
import { BlockJson } from '@/application/slate-yjs/types';
import { applyTextYEvent } from '@/application/slate-yjs/utils/applyTextToSlate';
import { blockToSlateNode, deltaInsertToSlateNode } from '@/application/slate-yjs/utils/convert';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { dataStringTOJson, getBlock, getChildrenArray, getPageId, getText } from '@/application/slate-yjs/utils/yjs';
import { YBlock, YjsEditorKey } from '@/application/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BlockMapEvent = YMapEvent<any>;

interface YBlockChange {
  action: string;
  oldValue: unknown;
}

/**
 * Translates Yjs events to Slate editor operations
 * This function processes different types of Yjs events and applies corresponding changes to the Slate editor
 *
 * @param editor - The YjsEditor instance
 * @param events - Array of Yjs events to process
 */
export function translateYEvents(editor: YjsEditor, events: Array<YEvent>) {
  console.debug('=== Translating Yjs events to Slate operations ===', {
    eventCount: events.length,
    eventTypes: events.map((e) => e.path.join('.')),
    timestamp: new Date().toISOString(),
  });

  events.forEach((event, index) => {
    console.debug(`Processing event ${index + 1}/${events.length}:`, {
      path: event.path,
      type: event.constructor.name,
    });

    // Handle block-level changes (document.blocks)
    if (isEqual(event.path, ['document', 'blocks'])) {
      console.debug('→ Applying block map changes');
      applyBlocksYEvent(editor, event as BlockMapEvent);
    }

    // Handle individual block updates (document.blocks[blockId])
    if (isEqual(event.path, ['document', 'blocks', event.path[2]])) {
      const blockId = event.path[2] as string;

      console.debug(`→ Applying block update for blockId: ${blockId}`);
      applyUpdateBlockYEvent(editor, blockId, event as YMapEvent<unknown>);
    }

    // Handle text content changes (document.meta.text_map[textId])
    if (isEqual(event.path, ['document', 'meta', 'text_map', event.path[3]])) {
      const textId = event.path[3] as string;

      console.debug(`→ Applying text content changes for textId: ${textId}`);
      applyTextYEvent(editor, textId, event as YTextEvent);
    }
  });

  console.debug('=== Yjs events translation completed ===');
}

/**
 * Applies block data updates to the Slate editor
 * Updates the data property of a block node when its Yjs data changes
 *
 * @param editor - The YjsEditor instance
 * @param blockId - The ID of the block to update
 * @param event - The Yjs map event containing the changes
 */
function applyUpdateBlockYEvent(editor: YjsEditor, blockId: string, event: YMapEvent<unknown>) {
  const { target } = event;
  const block = target as YBlock;
  const newData = dataStringTOJson(block.get(YjsEditorKey.block_data));
  const entry = findSlateEntryByBlockId(editor, blockId);

  if (!entry) {
    console.error(`❌ Block node not found in Slate editor: ${blockId}`, {
      availableBlocks: Array.from(editor.nodes({ at: [] }))
        .filter(([node]) => !Editor.isEditor(node) && Element.isElement(node) && node.blockId)
        .map(([node]) => (node as Element).blockId),
    });
    return [];
  }

  const [node, path] = entry;
  const oldData = node.data as Record<string, unknown>;

  console.debug(`✅ Updating block data for blockId: ${blockId}`, {
    path,
    oldDataKeys: Object.keys(oldData),
    newDataKeys: Object.keys(newData),
  });

  editor.apply({
    type: 'set_node',
    path,
    newProperties: {
      data: newData,
    },
    properties: {
      data: oldData,
    },
  });
}

/**
 * Applies block map changes to the Slate editor
 * Handles block additions, deletions, and updates based on Yjs map events
 *
 * @param editor - The YjsEditor instance
 * @param event - The Yjs map event containing block changes
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyBlocksYEvent(editor: YjsEditor, event: BlockMapEvent) {
  const { changes, keysChanged } = event;
  const { keys } = changes;

  console.debug('🔄 Processing block map changes:', {
    keysChangedCount: keysChanged?.size ?? 0,
    keysChanged: Array.from(keysChanged ?? []),
    changes: Array.from(keys.entries()).map(([key, value]) => ({
      key,
      action: value.action,
      oldValue: value.oldValue,
    })),
  });

  const keyPath: Record<string, number[]> = {};
  const updates: { key: string; action: string; value: YBlockChange }[] = [];

  keysChanged?.forEach((key: string) => {
    const value = keys.get(key);

    if (!value) {
      console.warn(`⚠️ No value found for key: ${key}`);
      return;
    }

    updates.push({ key, action: value.action, value: value as YBlockChange });
  });

  // Sort updates: delete first, then add/update
  updates.sort((a, b) => {
    if (a.action === 'delete' && b.action !== 'delete') return -1;
    if (a.action !== 'delete' && b.action === 'delete') return 1;
    return 0;
  });

  updates.forEach(({ key, action, value }, index) => {
    console.debug(`📋 Processing block change ${index + 1}/${updates.length}:`, {
      key,
      action,
      oldValue: value.oldValue,
    });

    if (action === 'add') {
      console.debug(`➕ Adding new block: ${key}`);
      handleNewBlock(editor, key, keyPath);
    } else if (action === 'delete') {
      console.debug(`🗑️ Deleting block: ${key}`);
      handleDeleteNode(editor, key);
    } else if (action === 'update') {
      console.debug(`🔄 Updating block: ${key}`);
      // TODO: Implement block update logic
    }
  });
}

/**
 * Handles the creation of new blocks in the Slate editor
 * Creates a new block node and inserts it at the appropriate position
 *
 * @param editor - The YjsEditor instance
 * @param key - The block ID
 * @param keyPath - Record to track block paths for nested operations
 */
function handleNewBlock(editor: YjsEditor, key: string, keyPath: Record<string, number[]>) {
  const block = getBlock(key, editor.sharedRoot);
  const parentId = block.get(YjsEditorKey.block_parent);
  const pageId = getPageId(editor.sharedRoot);
  const parent = getBlock(parentId, editor.sharedRoot);

  console.debug(`🏗️ Creating new block: ${key}`, {
    parentId,
    pageId,
    parentFound: !!parent,
  });

  if (!parent) {
    console.error(`❌ Parent block not found: ${parentId}`, {
      blockData: block.toJSON(),
      availableBlocks: Array.from(editor.nodes({ at: [] }))
        .filter(([node]) => !Editor.isEditor(node) && Element.isElement(node) && node.blockId)
        .map(([node]) => (node as Element).blockId),
    });
    return;
  }

  const parentChildren = getChildrenArray(parent.get(YjsEditorKey.block_children), editor.sharedRoot);
  const index = parentChildren.toArray().findIndex((child) => child === key);

  const slateNode = blockToSlateNode(block.toJSON() as BlockJson);
  const textId = block.get(YjsEditorKey.block_external_id);
  const yText = getText(textId, editor.sharedRoot);
  let textNode: Element | undefined;

  console.debug(`📊 Block creation details:`, {
    key,
    parentId,
    index,
    textId,
    yTextFound: !!yText,
    slateNodeType: slateNode.type,
  });

  if (yText) {
    const delta = yText?.toDelta();
    const slateDelta = delta.flatMap(deltaInsertToSlateNode);

    if (slateDelta.length === 0) {
      slateDelta.push({
        text: '',
      });
    }

    textNode = {
      textId,
      type: YjsEditorKey.text,
      children: slateDelta,
    };

    console.debug(`📝 Text node created:`, {
      textId,
      deltaLength: delta.length,
      slateDeltaLength: slateDelta.length,
    });
  }

  let path = [index];

  if (parentId !== pageId) {
    const [parentEntry] = editor.nodes({
      match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.blockId === parentId,
      mode: 'all',
      at: [],
    });

    if (!parentEntry) {
      if (keyPath[parentId]) {
        path = [...keyPath[parentId], index + 1];
        console.debug(`📍 Using cached path for nested block:`, { parentId, path });
      } else {
        console.error(`❌ Parent block not found in Slate editor: ${parentId}`, {
          keyPath,
          availableBlocks: Array.from(editor.nodes({ at: [] }))
            .filter(([node]) => !Editor.isEditor(node) && Element.isElement(node) && node.blockId)
            .map(([node]) => (node as Element).blockId),
        });
        return [];
      }
    } else {
      const silblings = (parentEntry[0] as Element).children;
      const childrenLength = silblings.length;

      const parentHasTextNode =
        childrenLength === 0 ? true : Element.isElement(silblings[0]) && silblings[0].type === YjsEditorKey.text;

      path = [...parentEntry[1], Math.min(index + (parentHasTextNode ? 1 : 0), childrenLength)];
      console.debug(`📍 Calculated path for nested block:`, {
        parentPath: parentEntry[1],
        childrenLength,
        finalPath: path,
      });
    }
  } else {
    console.debug(`📍 Using root-level path:`, { path });
  }

  console.debug(`✅ Inserting new block at path:`, {
    key,
    path,
    hasTextNode: !!textNode,
    childrenCount: textNode ? 1 : 0,
  });

  editor.apply({
    type: 'insert_node',
    path,
    node: {
      ...slateNode,
      children: textNode ? [textNode] : [],
    },
  });

  keyPath[key] = path;
  console.debug(`💾 Cached path for block ${key}:`, keyPath[key]);
}

/**
 * Handles the deletion of blocks from the Slate editor
 * Removes a block node from the editor when it's deleted in Yjs
 *
 * @param editor - The YjsEditor instance
 * @param key - The block ID to delete
 */
function handleDeleteNode(editor: YjsEditor, key: string) {
  const [entry] = editor.nodes({
    at: [],
    match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.blockId === key,
  });

  if (!entry) {
    console.error(`❌ Block not found for deletion: ${key}`, {
      availableBlocks: Array.from(editor.nodes({ at: [] }))
        .filter(([node]) => !Editor.isEditor(node) && Element.isElement(node) && node.blockId)
        .map(([node]) => (node as Element).blockId),
    });
    return [];
  }

  const [node, path] = entry;

  console.debug(`🗑️ Deleting block: ${key}`, {
    path,
    nodeType: (node as Element).type,
    childrenCount: (node as Element).children.length,
  });

  editor.apply({
    type: 'remove_node',
    path,
    node,
  });

  console.debug(`✅ Block deleted successfully: ${key}`);
}
