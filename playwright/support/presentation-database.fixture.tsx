import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Element } from 'slate';
import { parse as parseUuid } from 'uuid';
import * as Y from 'yjs';

import { FieldType, FilterType, SortCondition } from '@/application/database-yjs/database.type';
import { TextFilterCondition } from '@/application/database-yjs/fields/text/text.type';
import { getAxios, initAPIService } from '@/application/services/js-services/http/core';
import { AccessLevel, DatabaseViewLayout, Types, ViewLayout, type YDoc, type View } from '@/application/types';
import { AppNavigationContext, type AppNavigationContextType } from '@/components/app/contexts/AppNavigationContext';
import { AppOperationsContext, type AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { AppSyncContext } from '@/components/app/contexts/AppSyncContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { AFConfigContext } from '@/components/main/app.hooks';
import AppTheme from '@/components/main/AppTheme';
import DocumentPresenter from '@/components/presentation/DocumentPresenter';
import { snapshotFromSlate } from '@/components/presentation/snapshot-adapter';
import { database_blob } from '@/proto/database_blob';
import '@/styles/global.css';

const params = new URLSearchParams(location.search);
const databaseId = 'presentation-database';
const gridId = 'linked-grid';
const listId = 'linked-list';
const fields = ['name', 'status', 'private'];
const map = (value: Record<string, unknown>) => new Y.Map(Object.entries(value));
const array = (values: unknown[]) => {
  const value = new Y.Array();
  value.push(values);
  return value;
};
const rows: Record<string, YDoc> = {};
const rowIds = Array.from({ length: 36 }, () => crypto.randomUUID());

for (let index = 0; index < 36; index++) {
  const id = rowIds[index];
  const doc = new Y.Doc({ guid: `${databaseId}_rows_${id}` }) as YDoc;
  const title = index === 0 ? 'Excluded row' : `Milestone ${String(index).padStart(2, '0')}`;
  doc.getMap('data').set(
    'data',
    map({
      id,
      database_id: databaseId,
      height: 40,
      created_at: 1,
      last_modified: 1,
      cells: map({
        name: map({ field_type: FieldType.RichText, data: title }),
        status: map({ field_type: FieldType.SingleSelect, data: index % 2 ? 'ready' : 'progress' }),
        private: map({ field_type: FieldType.RichText, data: 'Hidden field value' }),
      }),
    })
  );
  rows[doc.guid] = doc;
}

const db = new Y.Doc({ guid: databaseId }) as YDoc;
const dbFields = map(
  Object.fromEntries(
    fields.map((id) => [
      id,
      map({
        id,
        name: id === 'name' ? 'Milestone' : id === 'status' ? 'Status' : 'Private notes',
        ty: id === 'status' ? FieldType.SingleSelect : FieldType.RichText,
        is_primary: id === 'name',
        type_option: map(
          id === 'status'
            ? {
                '3': map({
                  content: JSON.stringify({
                    options: [
                      { id: 'ready', name: 'Ready', color: 'Green' },
                      { id: 'progress', name: 'In progress', color: 'Orange' },
                    ],
                  }),
                }),
              }
            : {}
        ),
      }),
    ])
  )
);
const views = map(
  Object.fromEntries(
    [
      [gridId, DatabaseViewLayout.Grid],
      [listId, DatabaseViewLayout.List],
    ].map(([id, layout]) => [
      String(id),
      map({
        id,
        database_id: databaseId,
        name: layout === DatabaseViewLayout.Grid ? 'Milestones' : 'Work list',
        layout,
        field_orders: array(fields.map((id) => ({ id }))),
        row_orders: array(rowIds.map((id) => ({ id, height: 40 }))),
        field_settings: map(
          Object.fromEntries(
            fields.map((id) => [
              id,
              map({ width: id === 'name' ? 450 : 220, visibility: id === 'private' ? 2 : 0, wrap: true }),
            ])
          )
        ),
        filters: array([
          map({
            id: 'filter',
            field_id: 'name',
            ty: FieldType.RichText,
            filter_type: FilterType.Data,
            condition: TextFilterCondition.TextContains,
            content: 'Milestone',
          }),
        ]),
        sorts: array([map({ id: 'sort', field_id: 'name', condition: SortCondition.Descending })]),
        groups: array([]),
        layout_settings: map({}),
      }),
    ])
  )
);
db.getMap('data').set('database', map({ id: databaseId, fields: dbFields, views, metas: map({}) }));
let updates = 0;
for (const doc of [db, ...Object.values(rows)])
  doc.on('update', () => {
    document.documentElement.dataset.updates = String(++updates);
  });
document.documentElement.dataset.updates = '0';
document.documentElement.dataset.loads = '0';
document.documentElement.dataset.rowFetches = '0';
let rowFetches = 0;
initAPIService({ baseURL: location.origin, gotrueURL: location.origin, wsURL: '' });
// Test-owned transport fixture: exercise the real protobuf/cache/row loading path
// without connecting to a workspace or pre-seeding the browser's row cache.
getAxios()!.defaults.adapter = async (config) => {
  if (!config.url?.endsWith(`/database/${databaseId}/blob/diff`)) throw new Error(`Unexpected request: ${config.url}`);
  document.documentElement.dataset.rowFetches = String(++rowFetches);
  const data = database_blob.DatabaseBlobDiffResponse.encode({
    status: database_blob.DiffStatus.READY,
    page: { hasMore: false, restartRequired: false },
    updates: rowIds.map((id, index) => ({
      rowId: parseUuid(id),
      rid: { timestamp: 1, seqNo: index },
      docState: { docState: Y.encodeStateAsUpdate(rows[`${databaseId}_rows_${id}`]), encoderVersion: 1 },
    })),
  }).finish();
  return { status: 200, statusText: 'OK', headers: {}, config, data };
};
let loads = 0;
const viewMeta = (id: string) =>
  ({
    view_id: id,
    name: 'Milestones',
    layout: ViewLayout.Grid,
    extra: { database_id: databaseId },
    children: [],
  } as unknown as View);
const operations: AppOperationsContextType = {
  toView: async () => undefined,
  loadView: async (id) => {
    if (id !== gridId) throw new Error('Unexpected view load');
    document.documentElement.dataset.loads = String(++loads);
    return db;
  },
  loadViewMeta: async (id) => (id === 'page' ? { ...viewMeta(id), children: [viewMeta(gridId)] } : viewMeta(id)),
  createRow: async (key) => {
    if (!rows[key]) throw new Error(`Unknown row ${key}`);
    return rows[key];
  },
};
const permissions = {
  object_id: databaseId,
  collab_type: Types.Database,
  governing_view_id: gridId,
  access_level: AccessLevel.FullAccess,
  can_read: params.get('denied') !== '1',
  can_write: true,
  can_comment: true,
  can_share: true,
};
const navigation = {
  objectPermissions: { [gridId]: permissions, [listId]: { ...permissions, governing_view_id: listId } },
} as unknown as AppNavigationContextType;
const snapshot = snapshotFromSlate('page', 'Linked database presentation', {
  type: 'page',
  children: [
    { type: 'heading', blockId: 'heading', data: { level: 2 }, children: [{ text: 'Delivery milestones' }] },
    {
      type: 'grid',
      blockId: 'database-block',
      data: {
        parent_id: 'page',
        database_id: databaseId,
        ...(params.get('legacy') === '1' ? { view_id: gridId } : { view_ids: [gridId, listId] }),
      },
      children: [{ text: '' }],
    },
    // Native database embeds leave an editor spacer before the next heading.
    { type: 'paragraph', blockId: 'database-spacer', children: [{ text: '' }] },
    { type: 'heading', blockId: 'next-heading', data: { level: 2 }, children: [{ text: 'Next section' }] },
    { type: 'paragraph', blockId: 'after', children: [{ text: 'The next part of the presentation.' }] },
  ],
} as unknown as Element);

function Fixture() {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <AFConfigContext.Provider
        value={{ isAuthenticated: true, openLoginModal: () => undefined, updateCurrentUser: async () => undefined }}
      >
        <AuthInternalContext.Provider
          value={{ currentWorkspaceId: 'fixture', isAuthenticated: true, onChangeWorkspace: async () => undefined }}
        >
          <AppNavigationContext.Provider value={navigation}>
            <AppOperationsContext.Provider value={operations}>
              <AppSyncContext.Provider value={{}}>
                <AppTheme>
                  <button onClick={() => setOpen(true)}>Present document</button>
                  {open && (
                    <DocumentPresenter
                      snapshot={snapshot}
                      onClose={() => setOpen(false)}
                      onSource={() => setOpen(false)}
                    />
                  )}
                </AppTheme>
              </AppSyncContext.Provider>
            </AppOperationsContext.Provider>
          </AppNavigationContext.Provider>
        </AuthInternalContext.Provider>
      </AFConfigContext.Provider>
    </MemoryRouter>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
