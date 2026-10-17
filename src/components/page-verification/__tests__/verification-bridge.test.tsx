import { act, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { readVerificationFieldSnapshot } from '@/application/database-yjs/external-fields';
import { createFields } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { PageVerification } from '@/application/page-verification/types';
import { batchPageVerification, getVerificationProperty } from '@/application/services/js-services/http/page-verification-api';
import { YDatabase, YDatabaseFields, YDatabaseView, YDatabaseViews, YDoc, YjsDatabaseKey as K, YjsEditorKey } from '@/application/types';

import { VerificationDatabaseValues } from '../VerificationDatabaseValues';

jest.mock('@/application/publish', () => ({ usePublishContext: () => undefined }));
jest.mock('@/components/main/app.hooks', () => ({ useAuthenticatedUserIdOptional: () => 'bridge-user' }));
jest.mock('@/application/services/js-services/http/page-verification-api', () => ({
  batchPageVerification: jest.fn(), getVerificationProperty: jest.fn(),
}));

it('watches the raw row set, shares linked-view readers, and requires fresh authorization after closing', async () => {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = createFields([{ id: 'field', name: 'Verification', type: FieldType.Verification, typeOption: { property_id: 'generation' } }]).clone() as YDatabaseFields;
  const view = new Y.Map() as YDatabaseView;
  const views = new Y.Map() as YDatabaseViews;

  view.set(K.row_orders, Y.Array.from([{ id: 'visible', height: 44 }, { id: 'filtered-out', height: 44 }]));
  views.set('view', view);
  database.set(K.id, databaseDoc.guid);
  database.set(K.fields, fields);
  database.set(K.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const context: DatabaseContextState = { databaseDoc, databasePageId: 'view', activeViewId: 'view', workspaceId: 'workspace', readOnly: false, rowMap: {} };
  const property = { id: 'generation', database_id: databaseDoc.guid };
  const state = (target_id: string): PageVerification => ({ target_id, database_id: databaseDoc.guid, property, verification: null, status: 'unverified', eligible: true, can_edit: true });

  (getVerificationProperty as jest.Mock).mockResolvedValue({ property, eligible: true, can_edit: true });
  (batchPageVerification as jest.Mock).mockImplementation((_workspace, ids: string[]) => Promise.resolve({ items: ids.map(state), targets: Object.fromEntries(ids.map((id) => [id, id])) }));
  const host = (second: boolean) => <DatabaseContext.Provider value={context}>
    <VerificationDatabaseValues />
    {second && <VerificationDatabaseValues />}
  </DatabaseContext.Provider>;
  const mounted = render(host(true));
  const field = fields.get('field');
  const content = database.toJSON();

  await waitFor(() => expect(readVerificationFieldSnapshot(field, 'filtered-out')?.status).toBe('unverified'));
  expect(batchPageVerification).toHaveBeenCalledWith('workspace', expect.arrayContaining(['visible', 'filtered-out']));
  mounted.rerender(host(false));
  expect(readVerificationFieldSnapshot(field, 'visible')?.status).toBe('unverified');
  mounted.unmount();
  expect(readVerificationFieldSnapshot(field, 'visible')).toBeUndefined();

  let finish!: (value: unknown) => void;

  (batchPageVerification as jest.Mock).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const reopened = render(host(false));

  await waitFor(() => expect(finish).toBeDefined());
  expect(readVerificationFieldSnapshot(field, 'visible')).toBeUndefined();
  await act(async () => { finish({ items: [state('visible'), state('filtered-out')], targets: { visible: 'visible', 'filtered-out': 'filtered-out' } }); });
  await waitFor(() => expect(readVerificationFieldSnapshot(field, 'visible')?.status).toBe('unverified'));
  expect(database.toJSON()).toEqual(content);
  reopened.unmount();
});

it('preserves existing snapshots and subscriptions when rows are added or removed', async () => {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = createFields([{ id: 'field', name: 'Verification', type: FieldType.Verification, typeOption: { property_id: 'generation' } }]).clone() as YDatabaseFields;
  const view = new Y.Map() as YDatabaseView;
  const views = new Y.Map() as YDatabaseViews;

  view.set(K.row_orders, Y.Array.from([{ id: 'existing', height: 44 }]));
  views.set('view', view);
  database.set(K.id, databaseDoc.guid);
  database.set(K.fields, fields);
  database.set(K.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const context: DatabaseContextState = { databaseDoc, databasePageId: 'view', activeViewId: 'view', workspaceId: 'review-workspace', readOnly: false, rowMap: {} };
  const property = { id: 'generation', database_id: databaseDoc.guid };
  const state = (target_id: string): PageVerification => ({ target_id, database_id: databaseDoc.guid, property, verification: null, status: 'unverified', eligible: true, can_edit: true });

  (getVerificationProperty as jest.Mock).mockResolvedValue({ property, eligible: true, can_edit: true });
  (batchPageVerification as jest.Mock).mockImplementation((_workspace, ids: string[]) => Promise.resolve({ items: ids.map(state), targets: Object.fromEntries(ids.map((id) => [id, id])) }));
  const mounted = render(<DatabaseContext.Provider value={context}><VerificationDatabaseValues /></DatabaseContext.Provider>);
  const field = fields.get('field');

  try {
    await waitFor(() => expect(readVerificationFieldSnapshot(field, 'existing')?.status).toBe('unverified'));
    (batchPageVerification as jest.Mock).mockClear();
    (batchPageVerification as jest.Mock).mockImplementation(() => new Promise(() => undefined));
    await act(async () => { view.get(K.row_orders).push([{ id: 'new-row', height: 44 }]); });
    expect(readVerificationFieldSnapshot(field, 'existing')?.status).toBe('unverified');
    expect(batchPageVerification).toHaveBeenCalledTimes(1);
    expect(batchPageVerification).toHaveBeenCalledWith('review-workspace', ['new-row']);
    await act(async () => { view.get(K.row_orders).delete(1, 1); });
    expect(readVerificationFieldSnapshot(field, 'existing')?.status).toBe('unverified');
    expect(batchPageVerification).toHaveBeenCalledTimes(1);
  } finally { mounted.unmount(); }
});
