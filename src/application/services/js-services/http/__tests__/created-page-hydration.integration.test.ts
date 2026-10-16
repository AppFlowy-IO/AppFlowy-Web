/** Opt-in real HTTP and IndexedDB component check. Supply a private test-owned fixture JSON via APPFLOWY_ATOMIC_INTEROP_FIXTURE. */
import 'fake-indexeddb/auto';
import { readFileSync } from 'fs';
import * as http from 'http';
import { deserialize, serialize } from 'v8';

import { atomicRead, AtomicCreationOwner } from '@/application/atomic-creation';
import { readPersistedDatabaseSource } from '@/application/database-yjs/creation/source-readiness';
import { captureDatabaseStorageFence, closeCollabDB, db, openCollabDBWithProvider, openRowCollabDBWithProvider } from '@/application/db';
import { getAxios, initAPIService } from '@/application/services/js-services/http/core';
import { verifyCreatedPage } from '@/application/services/js-services/http/created-page-hydration';
import { prepareDefaultPage } from '@/application/services/js-services/http/page-default-creation';
import { saveGoTrueAuth } from '@/application/session/token';
import { View, ViewLayout, YjsEditorKey } from '@/application/types';

jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
const fixturePath = process.env.APPFLOWY_ATOMIC_INTEROP_FIXTURE;
const fixture = fixturePath ? JSON.parse(readFileSync(fixturePath, 'utf8')) : undefined;
const liveTest = fixture ? it : it.skip;
const calls: { path: string; elapsedMs: number }[] = [];
const owner: AtomicCreationOwner = { serverUrl: fixture?.baseURL, workspaceId: fixture?.workspaceId,
  userId: fixture?.token.user.id, assertCurrent() {} };
beforeAll(() => {
  if (!fixture) return;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(fixture.baseURL).hostname)) throw new Error('This component test requires an isolated local server');
  Object.assign(globalThis, { structuredClone: (value: unknown) => deserialize(serialize(value)) });
  initAPIService({ baseURL: fixture.baseURL, gotrueURL: fixture.gotrueURL, wsURL: `${fixture.baseURL.replace(/^http/, 'ws')}/ws` });
  saveGoTrueAuth(JSON.stringify(fixture.token));
  getAxios()!.defaults.adapter = async (config) => new Promise((resolve, reject) => {
    const start = Date.now();
    const url = new URL(config.url!, config.baseURL);

    for (const [key, value] of Object.entries(config.params ?? {})) url.searchParams.set(key, String(value));
    const request = http.request(url, { method: config.method, headers: config.headers.toJSON() as http.OutgoingHttpHeaders }, (response) => {
      const chunks: Buffer[] = [];

      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const bytes = Buffer.concat(chunks);

        calls.push({ path: url.pathname.replace(/\/[0-9a-f-]{36}/g, '/ID'), elapsedMs: Date.now() - start });
        if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}: ${bytes.toString().slice(0, 400)}`));
        resolve({ data: config.responseType === 'arraybuffer' ? bytes : JSON.parse(bytes.toString()),
          status: response.statusCode, statusText: 'OK', headers: response.headers, config });
      });
    });

    request.on('error', () => reject(new Error('Owned fixture transport failed')));
    if (config.data) request.write(typeof config.data === 'string' ? config.data : Buffer.from(config.data));
    request.end();
  });
});
afterAll(() => db.close());
liveTest.each([ViewLayout.Document, ViewLayout.Grid])('real HTTP compact creation and canonical IndexedDB hydration layout %s', async (layout) => {
  const opened = new Set<string>();

  try {
    const parent = await atomicRead<View>(owner, `/api/workspace/${fixture.workspaceId}/view/${fixture.workspaceId}`, { depth: 1 });
    const prepared = prepareDefaultPage(fixture.workspaceId, parent, { layout, name: 'Owned current-cache contract' });
    const path = prepared.kind === 'document' ? 'document' : 'database';
    const started = Date.now();
    const response = await getAxios()!.post(`/api/workspace/${fixture.workspaceId}/v2/page-view/${path}/default`, prepared.request);

    expect(response.data.code).toBe(0);
    const created = await verifyCreatedPage(owner, prepared);
    const objectId = prepared.kind === 'document' ? prepared.request.view_id : prepared.request.database.database_id;
    const { doc } = await openCollabDBWithProvider(objectId);

    opened.add(objectId);
    expect(doc.getMap(YjsEditorKey.data_section).has(prepared.kind)).toBe(true);
    expect(created.view_id).toBe(prepared.selectedViewId);
    if (prepared.kind === 'database') {
      expect(doc.databaseRestoreId).toBeUndefined();
      const storageFence = await captureDatabaseStorageFence(doc.guid, { required: true });

      await expect(readPersistedDatabaseSource(doc, new AbortController().signal, storageFence)).resolves.toBeInstanceOf(Uint8Array);
      // Default database hydration publishes seed Rows under the durable
      // database fence. Their deferred provider writes must own a separate
      // transaction and be durable before a later first-body creation uses them.
      expect(prepared.request.database.initial_row_ids).toHaveLength(3);
      for (const rowId of prepared.request.database.initial_row_ids) {
        opened.add(rowId);
        const row = await openRowCollabDBWithProvider(rowId, { awaitSync: true });
        const state = row.doc.getMap(YjsEditorKey.data_section).toJSON();
        const version = row.doc.version;

        expect(state.data.id).toBe(rowId);
        expect(state.data.database_id).toBe(objectId);
        if (!('whenPersisted' in row.provider)) throw new Error('The Row provider cannot confirm durability');
        await row.provider.whenPersisted();
        await closeCollabDB(rowId);
        const reopened = await openRowCollabDBWithProvider(rowId, { awaitSync: true });

        expect(reopened.doc).not.toBe(row.doc);
        expect(reopened.doc.version).toBe(version);
        expect(reopened.doc.getMap(YjsEditorKey.data_section).toJSON()).toEqual(state);
      }
    }
    console.log(JSON.stringify({ layout, elapsedMs: Date.now() - started, calls: calls.splice(0) }));
  } catch (error) { throw new Error(error instanceof Error ? error.message : 'Live contract failed'); }
  finally { await Promise.all([...opened].map((id) => closeCollabDB(id))); }
}, 30000);
