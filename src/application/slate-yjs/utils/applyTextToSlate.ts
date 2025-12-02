import { omit } from 'lodash-es';
import { Editor, Element, Operation, Path, Text } from 'slate';
import * as Y from 'yjs';

import { YjsEditor } from '@/application/slate-yjs';
import { Log } from '@/utils/log';

interface Delta {
  retain?: number;
  insert?: string | object;
  delete?: number;
  attributes?: Record<string, unknown>;
}

/**
 * Applies incremental text changes to the Slate editor
 */
function applyTextYEvent(editor: YjsEditor, textId: string, event: Y.YTextEvent) {
  // Find the text node in Slate
  const [entry] = editor.nodes({
    match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.textId === textId,
    mode: 'all',
    at: [],
  });

  if (!entry) {
    console.error(`❌ Text node not found in Slate editor: ${textId}`);
    return;
  }

  const [targetElement, textPath] = entry as [Element, number[]];
  const delta = event.delta as Delta[];

  Log.debug('📝 Applying YText event', {
    textId,
    delta,
    targetPath: textPath,
  });

  Editor.withoutNormalizing(editor, () => {
    const operations = applyDelta(targetElement, textPath, delta);

    Log.debug(`🔄 Generated ${operations.length} operations from delta:`, operations);

    operations.forEach((op, index) => {
      Log.debug(`Applying operation ${index + 1}/${operations.length}:`, op);
      editor.apply(op);
    });
  });
}

/**
 * Apply delta changes to generate Slate operations
 * Based on the reference implementation
 */
function applyDelta(node: Element, slatePath: Path, delta: Delta[]): Operation[] {
  const ops: Operation[] = [];

  // Calculate total offset for reverse processing
  let yOffset = delta.reduce((length, change) => {
    if ('retain' in change && change.retain) {
      return length + change.retain;
    }

    if ('delete' in change && change.delete) {
      return length + change.delete;
    }

    return length;
  }, 0);

  // Apply changes in reverse order to avoid path changes
  delta
    .slice()
    .reverse()
    .forEach((change) => {
      if ('attributes' in change && 'retain' in change && change.retain) {
        // Handle formatting operations
        const formatOps = handleAttributeChange(
          node,
          slatePath,
          yOffset - change.retain,
          yOffset,
          change.attributes || {}
        );

        ops.push(...formatOps);
      }

      if ('retain' in change && change.retain) {
        yOffset -= change.retain;
      }

      if ('delete' in change && change.delete) {
        // Handle delete operations
        const deleteOps = handleDelete(node, slatePath, yOffset - change.delete, yOffset);

        ops.push(...deleteOps);
        yOffset -= change.delete;
      }

      if ('insert' in change) {
        // Handle insert operations
        const insertOps = handleInsert(node, slatePath, yOffset, change.insert as string, change.attributes);

        ops.push(...insertOps);
      }
    });

  return ops;
}

/**
 * Handle attribute changes (formatting)
 */
function handleAttributeChange(
  node: Element,
  slatePath: Path,
  startOffset: number,
  endOffset: number,
  attributes: Record<string, unknown>
): Operation[] {
  const ops: Operation[] = [];

  Log.debug(`🎨 Applying attributes from offset ${startOffset} to ${endOffset}:`, attributes);

  // Convert Y offsets to Slate path/text offsets
  const [startPathOffset, startTextOffset] = yOffsetToSlateOffsets(node, startOffset);
  const [endPathOffset, endTextOffset] = yOffsetToSlateOffsets(node, endOffset, { assoc: -1 });

  // Validate path ranges before processing
  if (startPathOffset < 0 || endPathOffset >= node.children.length || startPathOffset > endPathOffset) {
    console.warn(
      `⚠️ Invalid path range (${startPathOffset} to ${endPathOffset}) for node with ${node.children.length} children, skipping attribute change`
    );
    return ops;
  }

  // Process nodes from end to start to avoid path changes
  for (let pathOffset = endPathOffset; pathOffset >= startPathOffset; pathOffset--) {
    // Check if the node still exists after previous operations
    if (!node.children[pathOffset]) {
      console.warn(`⚠️ Node at path offset ${pathOffset} no longer exists, skipping`);
      continue;
    }

    const child = node.children[pathOffset];
    const childPath = [...slatePath, pathOffset];

    if (!Text.isText(child)) {
      // Skip non-text nodes
      continue;
    }

    const newProperties = attributes;
    const properties = pick(child, ...(Object.keys(attributes) as (keyof Text)[]));

    // Handle partial node formatting (need to split)
    if (pathOffset === startPathOffset || pathOffset === endPathOffset) {
      const start = pathOffset === startPathOffset ? startTextOffset : 0;
      const end = pathOffset === endPathOffset ? endTextOffset : child.text.length;

      // Validate split positions to ensure they're within the text bounds
      if (start > child.text.length || end > child.text.length || start < 0 || end < 0) {
        console.warn(
          `⚠️ Invalid split positions (start: ${start}, end: ${end}) for text length ${child.text.length}, skipping split`
        );
        continue;
      }

      // Split at end first (to avoid path changes affecting start split)
      if (end !== child.text.length && end > 0) {
        ops.push({
          type: 'split_node',
          path: childPath,
          position: end,
          properties: getProperties(child),
        });
      }

      // Split at start
      if (start !== 0 && start > 0) {
        ops.push({
          type: 'split_node',
          path: childPath,
          position: start,
          properties: omitNullEntries({
            ...getProperties(child),
            ...newProperties,
          }),
        });
        continue;
      }
    }

    // Set node properties for full node formatting
    ops.push({
      type: 'set_node',
      newProperties,
      path: childPath,
      properties,
    });
  }

  return ops;
}

/**
 * Handle delete operations
 */
function handleDelete(node: Element, slatePath: Path, startOffset: number, endOffset: number): Operation[] {
  const ops: Operation[] = [];

  Log.debug(`➖ Deleting from offset ${startOffset} to ${endOffset}`);

  const [startPathOffset, startTextOffset] = yOffsetToSlateOffsets(node, startOffset);
  const [endPathOffset, endTextOffset] = yOffsetToSlateOffsets(node, endOffset, { assoc: -1 });

  // Validate path ranges before processing
  if (startPathOffset < 0 || endPathOffset >= node.children.length || startPathOffset > endPathOffset) {
    console.warn(
      `⚠️ Invalid path range for delete (${startPathOffset} to ${endPathOffset}) for node with ${node.children.length} children, skipping delete`
    );
    return ops;
  }

  // Process from end to start
  for (
    let pathOffset = endTextOffset === 0 ? endPathOffset - 1 : endPathOffset;
    pathOffset >= startPathOffset;
    pathOffset--
  ) {
    // Check if the node still exists
    if (!node.children[pathOffset]) {
      console.warn(`⚠️ Node at path offset ${pathOffset} no longer exists during delete, skipping`);
      continue;
    }

    const child = node.children[pathOffset];
    const childPath = [...slatePath, pathOffset];

    if (Text.isText(child) && (pathOffset === startPathOffset || pathOffset === endPathOffset)) {
      // Partial text deletion
      const start = pathOffset === startPathOffset ? startTextOffset : 0;
      const end = pathOffset === endPathOffset ? endTextOffset : child.text.length;

      // Validate deletion positions
      if (start > child.text.length || end > child.text.length || start < 0 || end < 0 || start >= end) {
        console.warn(
          `⚠️ Invalid delete positions (start: ${start}, end: ${end}) for text length ${child.text.length}, skipping text deletion`
        );
        continue;
      }

      ops.push({
        type: 'remove_text',
        offset: start,
        text: child.text.slice(start, end),
        path: childPath,
      });
    } else {
      // Complete node deletion
      ops.push({
        type: 'remove_node',
        node: child,
        path: childPath,
      });
    }
  }

  return ops;
}

/**
 * Handle insert operations
 */
function handleInsert(
  node: Element,
  slatePath: Path,
  offset: number,
  insert: string | object,
  attributes?: Record<string, unknown>
): Operation[] {
  const ops: Operation[] = [];

  Log.debug(`➕ Inserting at offset ${offset}:`, insert, attributes);

  const [pathOffset, textOffset] = yOffsetToSlateOffsets(node, offset, { insert: true });

  // Validate path offset before accessing child
  if (pathOffset < 0 || pathOffset >= node.children.length) {
    console.warn(
      `⚠️ Invalid path offset for insert (${pathOffset}) for node with ${node.children.length} children, skipping insert`
    );
    return ops;
  }

  const child = node.children[pathOffset];

  // Additional check if child exists
  if (!child) {
    console.warn(`⚠️ Child node at path offset ${pathOffset} does not exist during insert, skipping`);
    return ops;
  }

  const childPath = [...slatePath, pathOffset];

  if (Text.isText(child)) {
    // Validate text offset bounds
    if (textOffset < 0 || textOffset > child.text.length) {
      console.warn(
        `⚠️ Invalid text offset for insert (${textOffset}) for text with length ${child.text.length}, skipping insert`
      );
      return ops;
    }

    // Insert into text node
    if (typeof insert === 'string') {
      // Check if we can merge with existing text
      const currentProps = getProperties(child);

      if (deepEquals(attributes || {}, currentProps) && textOffset === child.text.length) {
        // Simple text insert
        ops.push({
          type: 'insert_text',
          offset: textOffset,
          text: insert,
          path: childPath,
        });
      } else {
        // Need to create new node
        const toInsert = deltaInsertToSlateNode({ insert, attributes });

        if (textOffset === 0) {
          ops.push({
            type: 'insert_node',
            path: childPath,
            node: toInsert,
          });
        } else if (textOffset < child.text.length) {
          // Split and insert
          ops.push({
            type: 'split_node',
            path: childPath,
            position: textOffset,
            properties: getProperties(child),
          });
          ops.push({
            type: 'insert_node',
            path: Path.next(childPath),
            node: toInsert,
          });
        } else {
          // Insert after
          ops.push({
            type: 'insert_node',
            path: Path.next(childPath),
            node: toInsert,
          });
        }
      }
    }
  } else {
    // Insert new node
    ops.push({
      type: 'insert_node',
      path: childPath,
      node: deltaInsertToSlateNode({ insert, attributes }),
    });
  }

  return ops;
}

/**
 * Convert Y offset to Slate path and text offsets
 */
function yOffsetToSlateOffsets(
  node: Element,
  yOffset: number,
  options: { assoc?: number; insert?: boolean } = {}
): [number, number] {
  let currentOffset = 0;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];

    if (Text.isText(child)) {
      const childLength = child.text.length;

      if (currentOffset + childLength >= yOffset) {
        return [i, yOffset - currentOffset];
      }

      currentOffset += childLength;
    }
  }

  // Handle end of node
  if (options.insert) {
    return [node.children.length, 0];
  }

  const lastIndex = node.children.length - 1;
  const lastChild = node.children[lastIndex];

  return Text.isText(lastChild) ? [lastIndex, lastChild.text.length] : [node.children.length, 0];
}

/**
 * Convert delta insert to Slate node
 */
function deltaInsertToSlateNode(change: { insert: string | object; attributes?: Record<string, unknown> }): Text {
  if (typeof change.insert === 'string') {
    return {
      text: change.insert,
      ...change.attributes,
    };
  }

  // Handle non-string inserts
  return { text: '' };
}

/**
 * Get properties from node (excluding text)
 */
function getProperties(node: Text): Record<string, unknown> {
  return omit(node, ['text']);
}

/**
 * Pick specific properties from object
 */
function pick<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;

  keys.forEach((key) => {
    if (key in obj) {
      result[key] = obj[key];
    }
  });
  return result;
}

/**
 * Remove null/undefined entries from object
 */
function omitNullEntries(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  Object.entries(obj).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  });
  return result;
}

/**
 * Deep equality check
 */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // eslint-disable-next-line eqeqeq
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) => deepEquals(a[key as keyof typeof a], b[key as keyof typeof b]));
  }

  return false;
}

export { applyTextYEvent };
