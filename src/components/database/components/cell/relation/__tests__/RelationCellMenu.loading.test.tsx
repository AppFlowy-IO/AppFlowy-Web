import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState, FieldType } from '@/application/database-yjs';
import { createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { type YDatabase, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import RelationCellMenu from '../RelationCellMenu';

import type { ReactNode } from 'react';

const mockUpdateRelationCell = jest.fn();
const mockRelationData = {
  loading: false,
  relations: { 'related-database': 'related-view' },
  selectedView: { view_id: 'related-view', name: 'Related tasks' },
  setSelectedView: jest.fn(),
  onUpdateDatabaseId: jest.fn(),
  views: [{ view_id: 'related-view', name: 'Related tasks' }],
  relatedDatabaseId: 'related-database',
};

jest.mock('@/application/database-yjs/dispatch/relation', () => ({
  ...jest.requireActual('@/application/database-yjs/dispatch/relation'),
  useUpdateRelationCell: () => mockUpdateRelationCell,
}));
jest.mock('@/components/database/components/property/relation/useRelationData', () => ({
  useRelationData: () => mockRelationData,
}));
jest.mock('@/components/database/components/cell/relation/NoDatabaseSelectedContent', () => ({
  __esModule: true,
  default: () => <span>Choose a database</span>,
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: (_key: string, fallback: string) => fallback }));
// Portal positioning is independent of the picker/query ownership tested here.
// Keep the actual RelationCellMenuContent, row loading and search implementation.
jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <>{children}</> : null,
  PopoverContent: ({ children }: { children: ReactNode }) => <div role='dialog'>{children}</div>,
  PopoverTrigger: () => null,
}));

function targetDoc(databaseId: string, viewId: string, rowIds: string[]) {
  const doc = new Y.Doc({ guid: viewId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map();
  const primary = new Y.Map();
  const view = new Y.Map();
  const views = new Y.Map();

  primary.set(YjsDatabaseKey.id, 'name');
  primary.set(YjsDatabaseKey.type, FieldType.RichText);
  primary.set(YjsDatabaseKey.is_primary, true);
  fields.set('name', primary);
  view.set(YjsDatabaseKey.row_orders, Y.Array.from(rowIds.map((id) => ({ id }))));
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  return doc;
}

function fixture() {
  const rows = Object.fromEntries(['Apple', 'Banana', 'Cherry'].map((name) => [
    name,
    createRowDoc(name, 'related-database', { name: { fieldType: FieldType.RichText, data: name } }),
  ]));
  const target = targetDoc('related-database', 'related-view', Object.keys(rows));
  const other = targetDoc('other-database', 'other-view', []);
  const loadView = jest.fn(async (viewId: string) => viewId === 'other-view' ? other : target);
  const createRow = jest.fn(async (key: string) => rows[key.split('_rows_')[1]]);
  let context: DatabaseContextState = {
    activeViewId: 'related-view',
    databaseDoc: target,
    databasePageId: 'related-view',
    workspaceId: 'workspace',
    rowMap: rows,
    readOnly: false,
    canWrite: true,
    loadView,
    createRow,
  };
  const ui = (open = true) => (
    <DatabaseContext.Provider value={context}>
      <RelationCellMenu open={open} rowId='Apple' fieldId='relation-field' />
    </DatabaseContext.Provider>
  );

  return {
    ui,
    loadView,
    createRow,
    revokeWrite: () => { context = { ...context, canWrite: false }; },
    destroy: () => { target.destroy(); other.destroy(); Object.values(rows).forEach((doc) => doc.destroy()); },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockRelationData.loading = false;
  mockRelationData.relatedDatabaseId = 'related-database';
  mockRelationData.selectedView = { view_id: 'related-view', name: 'Related tasks' };
});

afterEach(() => jest.useRealTimers());

test('same-target catalog refresh preserves the typed query and respects loading and write permission', async () => {
  const data = fixture();
  const rendered = render(data.ui());

  try {
    await act(async () => { jest.advanceTimersByTime(100); });
    await screen.findByText('Apple');
    fireEvent.change(screen.getByPlaceholderText('searchLabel'), { target: { value: 'Mango' } });
    await screen.findByTestId('relation-create-and-link');

    mockRelationData.loading = true;
    rendered.rerender(data.ui());
    expect(screen.queryByTestId('relation-create-and-link')).toBeNull();

    mockRelationData.loading = false;
    rendered.rerender(data.ui());
    const search = await screen.findByPlaceholderText<HTMLInputElement>('searchLabel');

    expect(search.value).toBe('Mango');
    await screen.findByTestId('relation-create-and-link');
    expect(data.loadView).toHaveBeenCalledTimes(1);
    expect(data.createRow).toHaveBeenCalledTimes(3);

    data.revokeWrite();
    rendered.rerender(data.ui());
    expect(search.value).toBe('Mango');
    expect(screen.queryByTestId('relation-create-and-link')).toBeNull();
    expect(mockUpdateRelationCell).not.toHaveBeenCalled();
  } finally {
    rendered.unmount();
    data.destroy();
  }
});

test('a different database starts with an empty query even while catalog metadata loads', async () => {
  const data = fixture();
  const rendered = render(data.ui());

  try {
    await act(async () => { jest.advanceTimersByTime(100); });
    await screen.findByText('Apple');
    fireEvent.change(screen.getByPlaceholderText('searchLabel'), { target: { value: 'Mango' } });
    mockRelationData.loading = true;
    mockRelationData.relatedDatabaseId = 'other-database';
    mockRelationData.selectedView = { view_id: 'other-view', name: 'Other tasks' };
    rendered.rerender(data.ui());
    mockRelationData.loading = false;
    rendered.rerender(data.ui());

    const search = await screen.findByPlaceholderText<HTMLInputElement>('searchLabel');

    expect(search.value).toBe('');
    await screen.findByText('findAndReplace.noResult');
    expect(screen.queryByText('Apple')).toBeNull();
    expect(screen.queryByTestId('relation-create-and-link')).toBeNull();
  } finally {
    rendered.unmount();
    data.destroy();
  }
});

test('known-target loading hides existing matches and Create until the catalog is ready', async () => {
  const data = fixture();
  const rendered = render(data.ui());

  try {
    await act(async () => { jest.advanceTimersByTime(100); });
    await screen.findByText('Apple');
    fireEvent.change(screen.getByPlaceholderText('searchLabel'), { target: { value: 'Apple' } });
    await screen.findByTestId('relation-create-and-link');

    mockRelationData.loading = true;
    rendered.rerender(data.ui());
    expect(screen.queryByText('Apple')).toBeNull();
    expect(screen.queryByText('findAndReplace.noResult')).toBeNull();
    expect(screen.queryByTestId('relation-create-and-link')).toBeNull();

    mockRelationData.loading = false;
    rendered.rerender(data.ui());
    const search = await screen.findByPlaceholderText<HTMLInputElement>('searchLabel');

    expect(search.value).toBe('Apple');
    await screen.findByText('Apple');
    expect(screen.queryByText('Banana')).toBeNull();
    await screen.findByTestId('relation-create-and-link');
  } finally {
    rendered.unmount();
    data.destroy();
  }
});

test('closing and reopening the picker starts a new query session', async () => {
  const data = fixture();
  const rendered = render(data.ui());

  try {
    await act(async () => { jest.advanceTimersByTime(100); });
    await screen.findByText('Apple');
    fireEvent.change(screen.getByPlaceholderText('searchLabel'), { target: { value: 'Mango' } });
    rendered.rerender(data.ui(false));
    rendered.rerender(data.ui());
    await act(async () => { jest.advanceTimersByTime(100); });

    const search = await screen.findByPlaceholderText<HTMLInputElement>('searchLabel');

    expect(search.value).toBe('');
    await screen.findByText('Apple');
    expect(screen.queryByTestId('relation-create-and-link')).toBeNull();
  } finally {
    rendered.unmount();
    data.destroy();
  }
});
