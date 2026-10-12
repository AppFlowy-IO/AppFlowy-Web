/** @jest-environment node */
import { readFileSync, writeFileSync } from 'node:fs';

import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import type {
  AtomicCreationReceipt,
  CreateDefaultDatabasePageRequest,
  PublishRowDocumentRequest,
} from '@/application/atomic-creation/types';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { getMetaIdMap, getMetaJSON } from '@/application/database-yjs/row_meta';
import { createBlock, getBlock, getChildrenArray, getText, updateBlockParent } from '@/application/slate-yjs/utils/yjs';
import { BlockType, DatabaseViewLayout, Types, YSharedRoot } from '@/application/types';

import { compileFirstBodyActions, createFirstBodyDraft } from '../first-body-actions';
import { templateDocumentInitialization } from '../template-document';


// Opt in with a test-owned account/workspace. Never read the installed app's
// credentials/configuration or persist authentication in its browser storage.
const fixturePath = process.env.APPFLOWY_ATOMIC_INTEROP_FIXTURE;
const run = fixturePath ? it : it.skip;

run(
  'the production first-body compiler interoperates with server defaults and exact replay',
  async () => {
    const fixture = JSON.parse(readFileSync(fixturePath!, 'utf8')) as {
      baseURL: string;
      workspaceId: string;
      token: { access_token: string };
    };
    const measurements: { operation: string; elapsedMs: number; requestBytes: number }[] = [];
    const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const encoded = body === undefined ? undefined : JSON.stringify(body);
      const start = performance.now();
      const response = await fetch(new URL(path, fixture.baseURL), {
        method,
        headers: { Authorization: `Bearer ${fixture.token.access_token}`, 'Content-Type': 'application/json' },
        body: encoded,
        signal: AbortSignal.timeout(30_000),
      });
      const result = (await response.json()) as { code: number; data: T; message?: string };

      measurements.push({
        operation: `${method} ${path}`,
        elapsedMs: performance.now() - start,
        requestBytes: encoded?.length ?? 0,
      });
      if (!response.ok || result.code !== 0) {
        throw new Error(
          `Atomic interop ${method} failed with HTTP ${response.status}, code ${result.code}: ${result.message ?? ''}`
        );
      }

      return result.data;
    };

    const workspace = `/api/workspace/${fixture.workspaceId}`;
    const containerId = uuidv4();
    const databaseId = uuidv4();
    const viewId = uuidv4();
    const rowId = uuidv4();
    const documentId = getMetaIdMap(rowId).get(RowMetaKey.DocumentId)!;
    const databaseRequest: CreateDefaultDatabasePageRequest = {
      schema_version: 'v1',
      request_id: uuidv4(),
      container_id: containerId,
      parent_view_id: fixture.workspaceId,
      name: 'Atomic row interop',
      database: {
        database_id: databaseId,
        view_id: viewId,
        name: 'Grid',
        layout: DatabaseViewLayout.Grid,
        embedded: false,
        responses_view_id: null,
        initial_row_ids: [rowId, uuidv4(), uuidv4()],
        timezone_id: null,
      },
    };

    await request('POST', `${workspace}/v2/page-view/database/default`, databaseRequest);
    const readCollab = async (id: string, type: Types) => {
      const query = new URLSearchParams({ collab_type: String(type) });

      if (type === Types.Document) {
        query.set('database_id', databaseId);
        query.set('row_id', rowId);
        query.set('row_document_id', documentId);
      }

      const result = await request<{ object_id: string; doc_state: number[]; version: number }>(
        'GET',
        `/api/workspace/v1/${fixture.workspaceId}/collab/${id}?${query}`
      );

      expect(result.object_id).toBe(id);
      const doc = new Y.Doc({ guid: id });

      if (result.version === 0) Y.applyUpdate(doc, new Uint8Array(result.doc_state));
      else if (result.version === 1) Y.applyUpdateV2(doc, new Uint8Array(result.doc_state));
      else throw new Error('Unexpected server encoding');
      expect(doc.store.pendingStructs).toBeNull();
      expect(doc.store.pendingDs).toBeNull();
      return doc;
    };

    const before = await readCollab(rowId, Types.DatabaseRow);

    expect(getMetaJSON(rowId, before.getMap('data').get('meta') as Y.Map<unknown>).isEmptyDocument).not.toBe(false);
    const draft = createFirstBodyDraft(documentId);
    const root = draft.getMap('data') as YSharedRoot;
    const page = getBlock(root.get('document').get('page_id'), root);
    const paragraph = getBlock(getChildrenArray(page.get('children'), root).get(0), root);
    const text = getText(paragraph.get('external_id'), root);

    text.applyDelta([
      { insert: 'first body ', attributes: { bold: true } },
      { insert: 'retained', attributes: { italic: true } },
    ]);
    const list = createBlock(root, { ty: BlockType.BulletedListBlock, data: { level: 1 } });

    updateBlockParent(root, list, page, 1);
    getText(list.get('external_id'), root).insert(0, 'list parent');
    const nested = createBlock(root, { ty: BlockType.Paragraph, data: {} });

    updateBlockParent(root, nested, list, 0);
    getText(nested.get('external_id'), root).insert(0, 'nested child');
    const image = createBlock(root, {
      ty: BlockType.ImageBlock,
      data: { url: 'https://example.test/owned-image', width: 512 },
    });

    updateBlockParent(root, image, page, 2);
    const restore = await request<{ database_restore_id: string | null }>(
      'GET',
      `${workspace}/database/${databaseId}/restore-state`
    );
    const command: PublishRowDocumentRequest = {
      request_id: uuidv4(),
      database_id: databaseId,
      database_restore_id: restore.database_restore_id ?? '00000000-0000-0000-0000-000000000000',
      row_id: rowId,
      source_view_id: viewId,
      name: 'Row first body',
      contribution: compileFirstBodyActions(draft),
    };
    const receipt = await request<AtomicCreationReceipt<'row-document'>>(
      'POST',
      `${workspace}/v2/page-view/row-document`,
      command
    );

    expect(receipt.outcome).toBe('applied');
    expect(receipt.result).toMatchObject({ document_id: documentId, row_id: rowId, database_id: databaseId });
    const [current, row] = await Promise.all([
      readCollab(documentId, Types.Document),
      readCollab(rowId, Types.DatabaseRow),
    ]);
    const currentRoot = current.getMap('data') as YSharedRoot;
    const authored = root.toJSON();

    // Rust stores absent optional external references as null; Web omits them.
    for (const block of Object.values(authored.document.blocks)) {
      block.external_id ??= null;
      block.external_type ??= null;
    }

    expect(currentRoot.toJSON()).toEqual(authored);
    expect(getText(paragraph.get('external_id'), currentRoot).toDelta()).toEqual(text.toDelta());
    expect(getChildrenArray(list.get('children'), currentRoot).toArray()).toEqual([nested.get('id')]);
    expect(getMetaJSON(rowId, row.getMap('data').get('meta') as Y.Map<unknown>).isEmptyDocument).toBe(false);
    const replay = await request<AtomicCreationReceipt<'row-document'>>(
      'POST',
      `${workspace}/v2/page-view/row-document`,
      command
    );

    expect(replay.outcome).toBe('already_applied');
    expect(replay.result).toEqual(receipt.result);
    const afterReplay = await readCollab(documentId, Types.Document);

    expect(afterReplay.getMap('data').toJSON()).toEqual(authored);
    // Explicit template editing initializes the same server-owned default
    // body before exposing block tools; ordinary empty Row opening stays lazy.
    const blankRowId = databaseRequest.database.initial_row_ids[1];
    const blankDocumentId = getMetaIdMap(blankRowId).get(RowMetaKey.DocumentId)!;
    const blankCommand = { ...command, request_id: uuidv4(), row_id: blankRowId,
      contribution: templateDocumentInitialization(blankDocumentId) };
    const blank = await request<AtomicCreationReceipt<'row-document'>>(
      'POST', `${workspace}/v2/page-view/row-document`, blankCommand
    );

    expect(blank.result.document_id).toBe(blankDocumentId);
    const query = new URLSearchParams({ collab_type: String(Types.Document), database_id: databaseId,
      row_id: blankRowId, row_document_id: blankDocumentId });
    const blankState = await request<{ doc_state: number[]; version: number }>(
      'GET', `/api/workspace/v1/${fixture.workspaceId}/collab/${blankDocumentId}?${query}`
    );
    const blankDoc = new Y.Doc();

    if (blankState.version === 0) Y.applyUpdate(blankDoc, new Uint8Array(blankState.doc_state));
    else Y.applyUpdateV2(blankDoc, new Uint8Array(blankState.doc_state));
    const blankBody = blankDoc.getMap('data').get('document') as Y.Map<unknown>;
    const blankTexts = (blankBody.get('meta') as Y.Map<unknown>).get('text_map') as Y.Map<Y.Text>;

    expect(Array.from(blankTexts.values()).every((value) => value.toString() === '')).toBe(true);
    expect(blankTexts.size).toBe(1);
    expect((blankBody.get('blocks') as Y.Map<unknown>).size).toBeGreaterThanOrEqual(2);
    const blankRow = await readCollab(blankRowId, Types.DatabaseRow);

    expect(getMetaJSON(blankRowId, blankRow.getMap('data').get('meta') as Y.Map<unknown>).isEmptyDocument).toBe(false);
    const blankReplay = await request<AtomicCreationReceipt<'row-document'>>(
      'POST', `${workspace}/v2/page-view/row-document`, blankCommand
    );

    expect(blankReplay.outcome).toBe('already_applied');
    expect(blankReplay.result).toEqual(blank.result);
    blankRow.destroy();
    blankDoc.destroy();
    const evidence = process.env.APPFLOWY_ATOMIC_INTEROP_EVIDENCE;

    if (evidence)
      writeFileSync(
        evidence,
        JSON.stringify({ containerId, databaseId, viewId, rowId, documentId, measurements }, null, 2),
        { mode: 0o600 }
      );
    [before, draft, current, row, afterReplay].forEach((doc) => doc.destroy());
  },
  120_000
);
