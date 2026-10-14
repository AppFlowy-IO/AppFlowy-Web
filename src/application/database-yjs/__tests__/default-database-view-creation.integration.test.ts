/**
 * @jest-environment node
 *
 * Opt-in Server contract for the compact recipes used by Web. Uses only a test-owned account.
 * APPFLOWY_ATOMIC_INTEROP_FIXTURE points to JSON {baseURL, token: {access_token}}. Creates and removes its own workspace.
 * Run with --testPathIgnorePatterns=/node_modules/ to enable this integration suite.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';

import type { CreateDefaultDatabaseViewRequest } from '@/application/atomic-creation/types';
import { YjsDatabaseKey, type View, type YDatabase, type YDatabaseFilter, type YDatabaseView } from '@/application/types';
import { collab } from '@/proto/messages';
import { grantTestWorkspaceProSubscription } from '../../../../playwright/support/subscription-test-helpers';

const fixturePath = process.env.APPFLOWY_ATOMIC_INTEROP_FIXTURE;
const contract = fixturePath ? it : it.skip;
const originalRestoreId = '00000000-0000-0000-0000-000000000000';
interface TestFixture {
  baseURL: string;
  token: { access_token: string };
}

function database(doc: Y.Doc): YDatabase {
  return doc.getMap('data').get('database') as YDatabase;
}

function comparable(value: unknown): unknown {
  // Rust integers decode as bigint; Web-generated numeric values decode as number.
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? Number(item) : item));
}

contract.each([0, 1, 2, 3, 4, 5, 6, 7, 8] as const)('publishes compact layout %s with current settings and an idempotent Folder graph', async (layout) => {
  const fixture = JSON.parse(readFileSync(fixturePath!, 'utf8')) as TestFixture;
  const headers = {
    Authorization: `Bearer ${fixture.token.access_token}`,
    'Content-Type': 'application/json',
    'client-version': 'web',
    'device-id': randomUUID(),
  };
  const measurements: { operation: string; milliseconds: number }[] = [];
  const request = async <T,>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const start = performance.now();
    const response = await fetch(fixture.baseURL + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json() as { code: number; message?: string; data: T };

    if (!response.ok || result.code !== 0) {
      // Do not include auth headers, fixture credentials, or request bodies in a failure.
      throw new Error(`${method} ${path}: HTTP ${response.status}, code ${result.code}: ${result.message}`);
    }

    if (method === 'POST' && path.endsWith('/database-view/default')) {
      measurements.push({ operation: 'compact view or replay', milliseconds: Math.round(performance.now() - start) });
    }

    return result.data;
  };
  const workspace = await request<{ workspace_id: string }>('/api/workspace', 'POST', { workspace_name: `Atomic Web contract ${randomUUID()}` });
  const workspaceId = workspace.workspace_id;
  const base = `/api/workspace/${workspaceId}`;
  const sync = async (databaseId: string, docState = new Uint8Array()): Promise<Y.Doc> => {
    const encoded = collab.CollabBatchSyncRequest.encode(collab.CollabBatchSyncRequest.create({
      items: [{ objectId: databaseId, collabType: 1, compression: 0, sv: Uint8Array.of(0), docState,
        databaseRestoreId: originalRestoreId }],
      responseCompression: 0,
    })).finish();
    const response = await fetch(`${fixture.baseURL}/api/workspace/v1/${workspaceId}/collab/full-sync/batch`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: encoded,
    });

    expect(response.status).toBe(200);
    const results = collab.CollabBatchSyncResponse.decode(new Uint8Array(await response.arrayBuffer())).results;

    expect(results).toHaveLength(1);
    expect(results[0].error).toBe('');
    const doc = new Y.Doc();

    const update = results[0].missingUpdate;

    if (!update) throw new Error('Database full-sync returned no content');
    Y.applyUpdate(doc, update);
    expect(doc.store.pendingStructs).toBeNull();
    expect(doc.store.pendingDs).toBeNull();
    return doc;
  };
  const containerId = randomUUID();
  const databaseId = randomUUID();
  const primaryId = randomUUID();
  const rows = [randomUUID(), randomUUID(), randomUUID()];
  let current: Y.Doc | undefined;

  try {
    if (layout === 8) grantTestWorkspaceProSubscription(workspaceId);
    const root = await request<View>(`${base}/view/${workspaceId}?depth=1`);
    const parentId = root.children[0]?.view_id ?? workspaceId;

    await request(`${base}/v2/page-view/database/default`, 'POST', {
      schema_version: 'v1', request_id: randomUUID(), container_id: containerId, parent_view_id: parentId,
      name: `Atomic Web contract ${randomUUID()}`, position: { kind: 'end' },
      database: { database_id: databaseId, view_id: primaryId, name: 'Grid', layout: 0, embedded: false,
        responses_view_id: null, initial_row_ids: rows, timezone_id: null },
    });
    current = await sync(databaseId);
    const source = database(current).get(YjsDatabaseKey.views).get(primaryId) as YDatabaseView;
    const fieldId = source.get(YjsDatabaseKey.field_orders).get(0).id;
    const filter = new Y.Map() as YDatabaseFilter;

    filter.set('id', randomUUID());
    filter.set('field_id', fieldId);
    filter.set('field_type', 0);
    filter.set('condition', 0);
    filter.set('content', 'contract-filter');
    source.get(YjsDatabaseKey.filters).push([filter]);
    source.get(YjsDatabaseKey.field_settings).get(fieldId).set('visibility', 0);
    const uploadReply = await sync(databaseId, Y.encodeStateAsUpdate(current));

    uploadReply.destroy();
    current.destroy();
    // An upload ACK is not a current-source proof. Probe independently as production readiness does.
    current = await sync(databaseId);
    const authoritativeSource = database(current).get(YjsDatabaseKey.views).get(primaryId);

    expect(authoritativeSource.get(YjsDatabaseKey.filters).length).toBe(1);
    const expectedFilters = comparable(authoritativeSource.get(YjsDatabaseKey.filters).toJSON());
    const expectedFields = comparable(authoritativeSource.get(YjsDatabaseKey.field_settings).toJSON());
    const expectedRows = comparable(authoritativeSource.get(YjsDatabaseKey.row_orders).toJSON());
    const createdViewIds: string[] = [];

    // Each layout owns a fresh workspace/Database, keeping normal view limits intact.
    // The client supplies no groups, fields, filters, or layout settings.
    const viewId = randomUUID();
    const responsesId = layout === 7 ? randomUUID() : null;
    const body: CreateDefaultDatabaseViewRequest = {
      schema_version: 'v1', request_id: randomUUID(), database_restore_id: originalRestoreId,
      view: { database_id: databaseId, view_id: viewId, parent_view_id: containerId,
        source_view_id: primaryId, name: `Contract ${layout}`, layout, embedded: false,
        responses_view_id: responsesId, timezone_id: layout === 2 || layout === 8 ? 'Asia/Shanghai' : null },
      position: { kind: 'end' }, icon: null, extra: null,
    };
    const endpoint = `${base}/v2/page-view/database-view/default`;
    const receipt = await request<{ result: { view_id: string } }>(endpoint, 'POST', body);
    const replay = await request<{ outcome: string }>(endpoint, 'POST', body);

    expect(receipt.result.view_id).toBe(viewId);
    expect(replay.outcome).toBe('already_applied');
    current.destroy();
    current = await sync(databaseId);
    const view = database(current).get(YjsDatabaseKey.views).get(viewId);

    expect(Number(view.get(YjsDatabaseKey.layout))).toBe(layout);
    expect(comparable(view.get(YjsDatabaseKey.filters).toJSON())).toEqual(expectedFilters);
    expect(comparable(view.get(YjsDatabaseKey.row_orders).toJSON())).toEqual(expectedRows);
    if (layout === 0) expect(comparable(view.get(YjsDatabaseKey.field_settings).toJSON())).toEqual(expectedFields);
    if (layout === 1) {
      // Older Web renders only persisted groups. Do not use its new fallback
      // or write a grouping update to make an incomplete server recipe pass.
      const groups = view.get(YjsDatabaseKey.groups);

      expect(groups.length).toBeGreaterThan(0);
      const group = groups.get(0);

      expect(database(current).get(YjsDatabaseKey.fields).has(group.get(YjsDatabaseKey.field_id))).toBe(true);
      expect(group.get(YjsDatabaseKey.groups).length).toBeGreaterThan(0);
    }
    const createdFolder = await request<View>(`${base}/view/${viewId}?depth=0`);

    expect(createdFolder.parent_view_id).toBe(containerId);
    expect(createdFolder.layout).toBe([1, 2, 3, 5, 6, 7, 8, 9, 10][layout]);
    const page = await request<{ view: View; data: { encoded_collab: number[] } }>(`${base}/page-view/${viewId}`);
    const pageDoc = new Y.Doc();

    try {
      Y.applyUpdate(pageDoc, Uint8Array.from(page.data.encoded_collab));
      expect(page.view.view_id).toBe(viewId);
      expect(database(pageDoc).get(YjsDatabaseKey.id)).toBe(databaseId);
      expect(database(pageDoc).get(YjsDatabaseKey.views).has(viewId)).toBe(true);
    } finally { pageDoc.destroy(); }

    createdViewIds.push(viewId);
    if (responsesId) {
      const companion = database(current).get(YjsDatabaseKey.views).get(responsesId);

      expect(Number(companion.get(YjsDatabaseKey.layout))).toBe(0);
      expect(comparable(companion.get(YjsDatabaseKey.row_orders).toJSON())).toEqual(expectedRows);
      const companionFolder = await request<View>(`${base}/view/${responsesId}?depth=0`);

      expect(companionFolder.parent_view_id).toBe(containerId);
      createdViewIds.push(responsesId);
    }
    const folder = await request<View>(`${base}/view/${containerId}?depth=1`);

    expect(folder.children.map((child) => child.view_id).sort()).toEqual([primaryId, ...createdViewIds].sort());
    // Exploratory local timings only: ordinary CI has no machine-dependent latency threshold.
    console.info('[Atomic DatabaseView contract]', JSON.stringify(measurements));
  } finally {
    current?.destroy();
    await request(`/api/workspace/${workspaceId}`, 'DELETE');
  }
}, 60_000);
