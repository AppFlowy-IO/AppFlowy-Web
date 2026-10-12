import { toBase64 } from 'lib0/buffer';
import { Root } from 'protobufjs/light';
import * as Y from 'yjs';

import { YjsEditorKey } from '@/application/types';

// Wire fields from Desktop's flowy-document/src/entities.rs. Using a small
// protobuf descriptor keeps optional/new fields compatible without bundling
// the complete Flutter dispatch schema or interpreting protobuf bytes as Yjs.
const documentSchema = {
  nested: {
    DocumentDataPB: {
      fields: {
        page_id: { type: 'string', id: 1 },
        blocks: { keyType: 'string', type: 'BlockPB', id: 2 },
        meta: { type: 'MetaPB', id: 3 },
      },
    },
    BlockPB: {
      fields: {
        id: { type: 'string', id: 1 },
        ty: { type: 'string', id: 2 },
        data: { type: 'string', id: 3 },
        parent_id: { type: 'string', id: 4 },
        children_id: { type: 'string', id: 5 },
        external_id: { type: 'string', id: 6 },
        external_type: { type: 'string', id: 7 },
      },
    },
    MetaPB: {
      fields: {
        children_map: { keyType: 'string', type: 'ChildrenPB', id: 1 },
        text_map: { keyType: 'string', type: 'string', id: 2 },
      },
    },
    ChildrenPB: { fields: { children: { rule: 'repeated', type: 'string', id: 1 } } },
  },
} as const;
const documentType = Root.fromJSON(documentSchema).lookupType('DocumentDataPB');

interface DocumentSnapshot {
  page_id: string;
  blocks: Record<
    string,
    {
      id: string;
      ty: string;
      data: string;
      parent_id: string;
      children_id: string;
      external_id?: string;
      external_type?: string;
    }
  >;
  meta: {
    children_map: Record<string, { children: string[] }>;
    text_map: Record<string, string>;
  };
}

const TEXT_BLOCKS = new Set([
  'paragraph',
  'heading',
  'numbered_list',
  'bulleted_list',
  'todo_list',
  'toggle_list',
  'quote',
  'callout',
]);

export function encodeTemplateDocument(doc: Y.Doc): string {
  return toBase64(Y.encodeStateAsUpdate(doc));
}

/** A materialized empty template has a server body but no authored content. */
export function readTemplateDocumentEmptiness(doc: Y.Doc): boolean | undefined {
  const body = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.document);
  const blocks = body instanceof Y.Map ? body.get(YjsEditorKey.blocks) : undefined;
  const meta = body instanceof Y.Map ? body.get(YjsEditorKey.meta) : undefined;
  const texts = meta instanceof Y.Map ? meta.get(YjsEditorKey.text_map) : undefined;

  if (!(body instanceof Y.Map) || !(blocks instanceof Y.Map) || !(texts instanceof Y.Map)) return undefined;
  for (const [id, block] of blocks.entries()) {
    if (!(block instanceof Y.Map)) return undefined;
    if (id === body.get(YjsEditorKey.page_id)) continue;
    const text = texts.get(block.get(YjsEditorKey.block_external_id));

    if (!TEXT_BLOCKS.has(block.get(YjsEditorKey.block_type)) ||
      (text instanceof Y.Text && text.toString().trim().length > 0)) return false;
  }

  return true;
}

/** Stored Desktop snapshots take precedence over a stale/missing orphan view. */
export function decodeTemplateDocumentSnapshot(bytes?: number[]):
  | {
      encodedState: string;
      isDocumentEmpty: boolean;
    }
  | undefined {
  if (!bytes?.length) return undefined;
  const doc = new Y.Doc();

  try {
    const snapshot = documentType.toObject(documentType.decode(Uint8Array.from(bytes)), {
      defaults: true,
    }) as DocumentSnapshot;

    if (!snapshot.page_id || !snapshot.blocks[snapshot.page_id] || !snapshot.meta) {
      throw new Error('Missing document root');
    }

    const document = new Y.Map();
    const blocks = new Y.Map<Y.Map<unknown>>();
    const meta = new Y.Map();
    const children = new Y.Map<Y.Array<string>>();
    const texts = new Y.Map<Y.Text>();
    let isDocumentEmpty = true;

    doc.transact(() => {
      doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.document, document);
      document.set(YjsEditorKey.page_id, snapshot.page_id);
      document.set(YjsEditorKey.blocks, blocks);
      document.set(YjsEditorKey.meta, meta);
      meta.set(YjsEditorKey.children_map, children);
      meta.set(YjsEditorKey.text_map, texts);
      Object.entries(snapshot.meta.children_map).forEach(([id, value]) => {
        const order = new Y.Array<string>();

        children.set(id, order);
        order.push(value.children);
      });
      Object.entries(snapshot.meta.text_map).forEach(([id, value]) => {
        const delta = JSON.parse(value);

        if (!Array.isArray(delta)) throw new Error('Invalid text delta');
        const text = new Y.Text();

        texts.set(id, text);
        text.applyDelta(delta);
      });
      Object.entries(snapshot.blocks).forEach(([id, block]) => {
        const value = new Y.Map<unknown>();

        blocks.set(id, value);
        value.set(YjsEditorKey.block_id, block.id);
        value.set(YjsEditorKey.block_type, block.ty);
        value.set(YjsEditorKey.block_data, block.data || '{}');
        value.set(YjsEditorKey.block_parent, block.parent_id);
        value.set(YjsEditorKey.block_children, block.children_id);
        if (block.external_id) value.set(YjsEditorKey.block_external_id, block.external_id);
        if (block.external_type) value.set(YjsEditorKey.block_external_type, block.external_type);
        if (
          id !== snapshot.page_id &&
          (!TEXT_BLOCKS.has(block.ty) || (block.external_id && texts.get(block.external_id)?.toString().trim()))
        )
          isDocumentEmpty = false;
      });
    });
    return { encodedState: encodeTemplateDocument(doc), isDocumentEmpty };
  } catch {
    throw new Error('Invalid template document snapshot');
  } finally {
    doc.destroy();
  }
}
