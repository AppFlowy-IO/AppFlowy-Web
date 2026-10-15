import { validate as isUuid } from 'uuid';
import * as Y from 'yjs';

import { isDatabaseBlockType } from '@/application/database-block';
import { initializeDocumentStructure, pageIdFromDocumentId } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YDoc, YjsEditorKey } from '@/application/types';

export interface FirstBodyBlock {
  id: string;
  ty: string;
  parent: string;
  children: string;
  external_id: string | null;
  external_type: string | null;
  data: Record<string, unknown>;
}

export interface FirstBodyAction {
  action: 'Delete' | 'Insert' | 'InsertText' | 'ApplyTextDelta';
  payload: {
    block?: FirstBodyBlock;
    prev_id?: string | null;
    parent_id?: string;
    text_id?: string;
    delta?: string;
    update_type: false;
  };
}

export interface FirstBodyContribution {
  kind: 'default_actions';
  schema_version: 'v1';
  actions: FirstBodyAction[];
}

const MAX_NODES = 1024;
const MAX_DEPTH = 128;
const MAX_ACTION_BYTES = 4 * 1024 * 1024;
const utf8 = (value: string) => new TextEncoder().encode(value).byteLength;

function invalid(message: string): never {
  throw new Error(`Invalid first row-page body: ${message}`);
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && utf8(value) <= 1024;

function map(value: unknown): Y.Map<unknown> {
  return value instanceof Y.Map ? value : invalid('missing map');
}

function structure(doc: Y.Doc) {
  const document = map(doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.document));
  const meta = map(document.get(YjsEditorKey.meta));

  return {
    pageId: document.get(YjsEditorKey.page_id),
    blocks: map(document.get(YjsEditorKey.blocks)),
    children: map(meta.get(YjsEditorKey.children_map)),
    texts: map(meta.get(YjsEditorKey.text_map)),
  };
}

/** A private placeholder: never put this document in a cache, provider, or sync outbox. */
export function createFirstBodyDraft(documentId: string): YDoc {
  if (!isUuid(documentId) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(documentId)) invalid('invalid document identity');
  const doc = new Y.Doc({ guid: documentId }) as YDoc;

  initializeDocumentStructure(doc, true, documentId);
  const { pageId, blocks, texts } = structure(doc);
  const root = map(blocks.get(pageId as string));

  // The v1 server root is structural only. The normal Web editor's extra root
  // text is useful elsewhere, but is not authored content in this protocol.
  root.set(YjsEditorKey.block_parent, '');
  root.set(YjsEditorKey.block_data, '{}');
  root.delete(YjsEditorKey.block_external_id);
  root.delete(YjsEditorKey.block_external_type);
  texts.delete(pageId as string);
  return doc;
}

function blockFromMap(value: unknown): FirstBodyBlock {
  const block = map(value);
  const raw = block.get(YjsEditorKey.block_data);
  let data: unknown;

  try {
    data = JSON.parse(typeof raw === 'string' ? raw : invalid('malformed block data'));
  } catch {
    return invalid('malformed block data');
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) invalid('block data must be an object');
  return {
    id: block.get(YjsEditorKey.block_id) as string,
    ty: block.get(YjsEditorKey.block_type) as string,
    parent: block.get(YjsEditorKey.block_parent) as string,
    children: block.get(YjsEditorKey.block_children) as string,
    external_id: (block.get(YjsEditorKey.block_external_id) as string | undefined) ?? null,
    external_type: (block.get(YjsEditorKey.block_external_type) as string | undefined) ?? null,
    data: data as Record<string, unknown>,
  };
}

function validateData(value: unknown, documentId: string, blockIds: Set<string>, depth = 0): void {
  if (depth > MAX_DEPTH) invalid('metadata nesting limit exceeded');
  if (typeof value === 'number' && !Number.isFinite(value)) invalid('non-finite metadata');
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) {
    const object = value as Record<string, unknown>;

    if (object.pending_upload_id || object.retry_local_url) invalid('upload has not completed');
    if ('mention' in object) {
      const mention = object.mention;

      if (!mention || typeof mention !== 'object' || Array.isArray(mention)) invalid('malformed mention');
      const fields = mention as Record<string, unknown>;
      const page = fields.page_id;

      if (page !== undefined && !validId(page)) invalid('invalid mention page');
      if (
        'block_id' in fields &&
        (!validId(fields.block_id) || ((page === undefined || page === documentId) && !blockIds.has(fields.block_id)))
      )
        invalid('unresolved mention block');
    }
  }

  Object.values(value).forEach((child) => validateData(child, documentId, blockIds, depth + 1));
}

export function hasFirstBodyContent(doc: Y.Doc): boolean {
  const { blocks, texts } = structure(doc);

  for (const value of texts.values()) {
    if (value instanceof Y.Text && value.length > 0) return true;
  }

  for (const value of blocks.values()) {
    const type = map(value).get(YjsEditorKey.block_type);

    if (type !== BlockType.Page && type !== BlockType.Paragraph) return true;
  }

  return false;
}

/** Compile a sealed forest. No CRDT bytes, clocks, provider state, or root edits cross this boundary. */
export function compileFirstBodyActions(doc: Y.Doc): FirstBodyContribution {
  const { pageId, blocks, children, texts } = structure(doc);

  if (pageId !== pageIdFromDocumentId(doc.guid) || !validId(pageId)) invalid('unexpected root identity');
  if (blocks.size < 1 || blocks.size > MAX_NODES || children.size > MAX_NODES || texts.size > MAX_NODES)
    invalid('node limit exceeded');
  const parsed = new Map<string, FirstBodyBlock>();
  const childOwners = new Set<string>();
  const textOwners = new Set<string>();

  for (const [key, value] of blocks.entries()) {
    const block = blockFromMap(value);

    if (
      !validId(key) ||
      block.id !== key ||
      !validId(block.ty) ||
      typeof block.children !== 'string' ||
      utf8(block.children) > 1024
    )
      invalid('invalid block identity');
    if (isDatabaseBlockType(block.ty) || block.ty === BlockType.SubpageBlock)
      invalid('nested pages and databases require compound creation');
    if (childOwners.has(block.children) && block.children !== '') invalid('shared child container');
    childOwners.add(block.children);
    if ((block.external_id === null) !== (block.external_type === null)) invalid('incomplete external reference');
    if (block.external_id !== null && (!validId(block.external_id) || !validId(block.external_type)))
      invalid('invalid external reference');
    if (block.external_type === 'text') {
      if (textOwners.has(block.external_id!)) invalid('shared text');
      textOwners.add(block.external_id!);
    }

    parsed.set(key, block);
  }

  const root = parsed.get(pageId)!;

  if (
    !root ||
    root.ty !== BlockType.Page ||
    root.parent !== '' ||
    root.children !== pageId ||
    root.external_id !== null ||
    root.external_type !== null ||
    Object.keys(root.data).length
  )
    invalid('root must be structural only');
  for (const [id, value] of children.entries()) {
    if (!childOwners.has(id) || !(value instanceof Y.Array) || value.length > MAX_NODES || (id === '' && value.length))
      invalid('unowned or invalid children');
  }

  if (textOwners.size !== texts.size || Array.from(texts.keys()).some((id) => !textOwners.has(id)))
    invalid('missing or unowned text');

  const blank = createFirstBodyDraft(doc.guid);
  const blankTree = structure(blank);
  const defaultParagraph = Array.from(blankTree.blocks.values())
    .map(blockFromMap)
    .find((block) => block.ty === BlockType.Paragraph)!;

  blank.destroy();
  const actions: FirstBodyAction[] = [{ action: 'Delete', payload: { block: defaultParagraph, update_type: false } }];
  const visited = new Set<string>();
  const blockIds = new Set(parsed.keys());
  const visit = (id: string, parent: string | null, prev: string | null, depth: number) => {
    if (depth > MAX_DEPTH || visited.has(id)) invalid('cycle, duplicate edge, or depth limit');
    visited.add(id);
    const block = parsed.get(id);

    if (!block || (parent !== null && block.parent !== parent)) invalid('missing child or mismatched parent');
    validateData(block.data, doc.guid, blockIds);
    if (parent !== null) {
      actions.push({ action: 'Insert', payload: { block, parent_id: parent, prev_id: prev, update_type: false } });
      if (block.external_type === 'text') {
        const text = texts.get(block.external_id!);

        if (!(text instanceof Y.Text)) invalid('missing owned text');
        const delta = text.toDelta();

        for (const op of delta) {
          if (
            typeof op.insert !== 'string' ||
            Object.keys(op).some((key) => key !== 'insert' && key !== 'attributes') ||
            (op.attributes !== undefined &&
              (!op.attributes || typeof op.attributes !== 'object' || Array.isArray(op.attributes)))
          )
            invalid('text must contain complete string inserts');
        }

        validateData(delta, doc.guid, blockIds);
        actions.push({
          action: 'InsertText',
          payload: { text_id: block.external_id!, delta: JSON.stringify(delta), update_type: false },
        });
      }
    }

    const ids = children.get(block.children);

    if (ids === undefined && block.children !== '') invalid('missing children container');
    if (ids instanceof Y.Array)
      ids.toArray().forEach((child: unknown, index: number, siblings: unknown[]) => {
        if (!validId(child)) invalid('invalid child identity');
        visit(child, id, index === 0 ? null : (siblings[index - 1] as string), depth + 1);
      });
  };

  visit(pageId, null, null, 0);
  if (visited.size !== parsed.size) invalid('unreachable authored block');
  if (actions.length > MAX_NODES || utf8(JSON.stringify(actions)) > MAX_ACTION_BYTES) invalid('action limit exceeded');
  return { kind: 'default_actions', schema_version: 'v1', actions };
}
