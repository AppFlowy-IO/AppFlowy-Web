import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import * as api from '@/application/services/js-services/http/page-verification-api';
import { YDatabase, YDatabaseFields, YDatabaseViews, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { useDatabaseVerification } from '../database';
import { createNativeVerificationField, getVerificationPropertyId, getVerificationSourceType } from '../native';
import type { VerificationPropertyState } from '../types';

let mockUserId = 'user';

jest.mock('@/components/main/app.hooks', () => ({ useAuthenticatedUserIdOptional: () => mockUserId }));
jest.mock('@/application/publish', () => ({ usePublishContext: () => undefined }));
jest.mock('@/application/services/js-services/http/page-verification-api', () => ({
  getVerificationProperty: jest.fn(), createVerificationProperty: jest.fn(), deleteVerificationProperty: jest.fn(),
  clearVerificationProperty: jest.fn(), setVerificationViewSettings: jest.fn(), batchPageVerification: jest.fn(),
}));

let sequence = 0;

function fixture() {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const databaseId = `lifecycle-${++sequence}`;

  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, new Y.Map() as YDatabaseFields);
  database.set(YjsDatabaseKey.views, new Y.Map() as YDatabaseViews);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  let readOnly = false;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={{ databaseDoc, databasePageId: 'view', activeViewId: 'view', workspaceId: 'workspace', rowMap: {}, readOnly } as DatabaseContextState}>
      {children}
    </DatabaseContext.Provider>
  );
  const property = { id: 'generation-a', database_id: databaseId, workspace_id: 'workspace' };
  const state = { eligible: true, can_edit: true, property: null, views: {} } as VerificationPropertyState;

  (api.getVerificationProperty as jest.Mock).mockImplementation(async () => state);
  return { database, databaseId, wrapper, property, state, setReadOnly: (value: boolean) => { readOnly = value; } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'user';
});

describe('authenticated native Verification lifecycle', () => {
  it('supports ordinary page headers outside a database context', () => {
    const { result } = renderHook(useDatabaseVerification);

    expect(result.current.store).toBeUndefined();
    expect(result.current.field).toBeUndefined();
    expect(api.getVerificationProperty).not.toHaveBeenCalled();
  });

  it('does not commit a created Cloud binding after editing permission is lost', async () => {
    const f = fixture();
    let resolveCreate!: (property: typeof f.property) => void;

    (api.createVerificationProperty as jest.Mock).mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
    const { result, rerender } = renderHook(useDatabaseVerification, { wrapper: f.wrapper });

    await waitFor(() => expect(result.current.state?.can_edit).toBe(true));
    let pending!: Promise<void>;

    act(() => { pending = result.current.create(); });
    f.setReadOnly(true);
    rerender();
    await act(async () => {
      resolveCreate(f.property);
      await expect(pending).rejects.toThrow('permissions or workspace changed');
    });
    expect(f.database.get(YjsDatabaseKey.fields).size).toBe(0);
  });

  it('rejects a captured dialog action after permission loss and recovery', async () => {
    const f = fixture();

    f.state.property = f.property as VerificationPropertyState['property'];
    const id = createNativeVerificationField(f.database, f.property.id);
    const { result, rerender } = renderHook(useDatabaseVerification, { wrapper: f.wrapper });

    await waitFor(() => expect(result.current.fieldId).toBe(id));
    const capturedRemove = result.current.remove;

    f.setReadOnly(true);
    rerender();
    f.setReadOnly(false);
    rerender();
    await expect(capturedRemove()).rejects.toThrow('permissions or workspace changed');
    expect(api.deleteVerificationProperty).not.toHaveBeenCalled();
    expect(f.database.get(YjsDatabaseKey.fields).has(id)).toBe(true);
  });

  it('rejects a captured action after authenticated account changes', async () => {
    const f = fixture();

    f.state.property = f.property as VerificationPropertyState['property'];
    createNativeVerificationField(f.database, f.property.id);
    const { result, rerender } = renderHook(useDatabaseVerification, { wrapper: f.wrapper });

    await waitFor(() => expect(result.current.field).toBeDefined());
    const capturedClear = result.current.clear;

    await act(async () => {
      mockUserId = 'other-user';
      rerender();
    });
    await expect(capturedClear()).rejects.toThrow('permissions or workspace changed');
    expect(api.clearVerificationProperty).not.toHaveBeenCalled();
  });

  it('discards dormant property authorization and refetches after an in-flight teardown', async () => {
    const f = fixture();
    let completeOld!: (value: VerificationPropertyState) => void;
    let completeFresh!: (value: VerificationPropertyState) => void;

    (api.getVerificationProperty as jest.Mock)
      .mockImplementationOnce(() => new Promise((resolve) => { completeOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { completeFresh = resolve; }));
    const first = renderHook(useDatabaseVerification, { wrapper: f.wrapper });

    await waitFor(() => expect(api.getVerificationProperty).toHaveBeenCalledTimes(1));
    first.unmount();
    const reopened = renderHook(useDatabaseVerification, { wrapper: f.wrapper });

    expect(reopened.result.current.state).toBeUndefined();
    await act(async () => { completeOld({ ...f.state, can_edit: true }); });
    await waitFor(() => expect(api.getVerificationProperty).toHaveBeenCalledTimes(2));
    expect(reopened.result.current.state).toBeUndefined();
    await act(async () => { completeFresh({ ...f.state, can_edit: false }); });
    expect(reopened.result.current.state?.can_edit).toBe(false);
  });

  it('repairs an unbound native field without replacing its ID or source options', async () => {
    const f = fixture();
    const id = createNativeVerificationField(f.database, 'old-generation');

    f.state.property = f.property as VerificationPropertyState['property'];
    const { result } = renderHook(useDatabaseVerification, { wrapper: f.wrapper });

    await waitFor(() => expect(result.current.state?.can_edit).toBe(true));
    expect(result.current.fieldId).toBeUndefined();
    expect(result.current.nativeFieldId).toBe(id);
    await act(async () => { await result.current.create(); });
    const field = f.database.get(YjsDatabaseKey.fields).get(id);

    expect(getVerificationPropertyId(field)).toBe(f.property.id);
    expect(getVerificationSourceType(field)).toBe(FieldType.RichText);
    expect(result.current.fieldId).toBe(id);
    expect(api.createVerificationProperty).not.toHaveBeenCalled();
  });
});
