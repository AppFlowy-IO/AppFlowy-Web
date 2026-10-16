import { toBase64 } from 'lib0/buffer';
import { Root } from 'protobufjs/light';
import * as Y from 'yjs';

import { hasYjsBlockContent } from '@/application/row-document/content';
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

    if (hasYjsBlockContent(block) || (text instanceof Y.Text && text.length > 0)) return false;
  }

  return true;
}

/** Freeze a canonical document in the same protobuf format consumed by Desktop templates. */
export function encodeTemplateDocumentSnapshot(doc: Y.Doc): number[] {
  if (doc.store.pendingDs || doc.store.pendingStructs || readTemplateDocumentEmptiness(doc) === undefined) {
    throw new Error('Invalid template document snapshot');
  }

  const body = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.document) as Y.Map<unknown>;
  const blocks = body.get(YjsEditorKey.blocks) as Y.Map<Y.Map<unknown>>;
  const meta = body.get(YjsEditorKey.meta) as Y.Map<unknown>;
  const children = meta.get(YjsEditorKey.children_map) as Y.Map<Y.Array<string>>;
  const texts = meta.get(YjsEditorKey.text_map) as Y.Map<Y.Text>;
  const pageId = String(body.get(YjsEditorKey.page_id));

  if (
    !blocks.has(pageId) ||
    [...blocks.values()].some((block) => !(block instanceof Y.Map)) ||
    !(children instanceof Y.Map) ||
    [...children.values()].some((order) => !(order instanceof Y.Array)) ||
    [...texts.values()].some((text) => !(text instanceof Y.Text))
  )
    throw new Error('Invalid template document snapshot');
  const snapshot: DocumentSnapshot = {
    page_id: pageId,
    blocks: Object.fromEntries(
      [...blocks.entries()].map(([id, block]) => [
        id,
        {
          id,
          ty: String(block.get(YjsEditorKey.block_type) ?? ''),
          data: String(block.get(YjsEditorKey.block_data) ?? '{}'),
          parent_id: String(block.get(YjsEditorKey.block_parent) ?? ''),
          children_id: String(block.get(YjsEditorKey.block_children) ?? ''),
          external_id: String(block.get(YjsEditorKey.block_external_id) ?? ''),
          external_type: String(block.get(YjsEditorKey.block_external_type) ?? ''),
        },
      ])
    ),
    meta: {
      children_map: Object.fromEntries(
        [...children.entries()].map(([id, order]) => [id, { children: order.toArray() }])
      ),
      text_map: Object.fromEntries([...texts.entries()].map(([id, text]) => [id, JSON.stringify(text.toDelta())])),
    },
  };

  return Array.from(documentType.encode(snapshot).finish());
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
      });
    });
    return { encodedState: encodeTemplateDocument(doc), isDocumentEmpty: readTemplateDocumentEmptiness(doc)! };
  } catch {
    throw new Error('Invalid template document snapshot');
  } finally {
    doc.destroy();
  }
}
