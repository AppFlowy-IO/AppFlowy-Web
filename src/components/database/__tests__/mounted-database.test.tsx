import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import type { DatabaseContextState } from '@/application/database-yjs/context';
import { UIVariant, type YDoc } from '@/application/types';

import { useMountedDatabase, usePublishMountedDatabase } from '../mounted-database';

let mockSession = 'first-login';

jest.mock('@/application/session/token', () => ({
  captureTokenSession: () => mockSession,
  isTokenSessionCurrent: (session: string) => session === mockSession,
}));

function context(view = 'view'): DatabaseContextState {
  return {
    workspaceId: 'workspace',
    activeViewId: view,
    databasePageId: view,
    databaseDoc: new Y.Doc({ guid: 'database' }) as YDoc,
    rowMap: { row: new Y.Doc() as YDoc },
    readOnly: false,
    variant: UIVariant.App,
  };
}

beforeEach(() => {
  mockSession = 'first-login';
});

test('mounted views lend the same live docs and loaders, release ownership and follow restored docs', () => {
  const original = context();
  const publisher = renderHook(({ value }) => usePublishMountedDatabase(value, 'Tasks'), {
    initialProps: { value: original },
  });
  const reader = renderHook(() => useMountedDatabase('workspace', 'view', 'database'));

  expect(reader.result.current?.context).toBe(original);
  const row = original.rowMap!.row;

  act(() => {
    row.getText('text').insert(0, 'Edited content');
  });
  expect(reader.result.current?.context.rowMap!.row.getText('text').toString()).toBe('Edited content');
  const restored = context();

  publisher.rerender({ value: restored });
  expect(reader.result.current?.context.databaseDoc).toBe(restored.databaseDoc);
  expect(reader.result.current?.context.rowMap).toBe(restored.rowMap);
  publisher.unmount();
  expect(reader.result.current).toBeUndefined();
});

test('workspace, mapping, account and view changes cannot reuse an old resource', () => {
  const value = context();
  const publisher = renderHook(() => usePublishMountedDatabase(value, 'Tasks'));
  const reader = renderHook(({ workspace, view, database }) => useMountedDatabase(workspace, view, database), {
    initialProps: { workspace: 'workspace', view: 'view', database: 'database' },
  });

  for (const changed of [{ workspace: 'other' }, { view: 'other' }, { database: 'remapped' }]) {
    reader.rerender({ workspace: 'workspace', view: 'view', database: 'database', ...changed });
    expect(reader.result.current).toBeUndefined();
  }

  mockSession = 'replacement-login';
  publisher.rerender();
  reader.rerender({ workspace: 'workspace', view: 'view', database: 'database' });
  expect(reader.result.current).toBeUndefined();
});

test.each(['publish', 'history', 'projection'] as const)('%s does not lend data to live views', (kind) => {
  const value = context();

  if (kind === 'publish') value.variant = UIVariant.Publish;
  if (kind === 'history') value.dataSource = { type: 'history', id: 'old-version' };
  renderHook(() => usePublishMountedDatabase(value, 'Tasks', kind !== 'projection'));
  expect(renderHook(() => useMountedDatabase('workspace', 'view')).result.current).toBeUndefined();
});
