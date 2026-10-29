import { act, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { YjsDatabaseKey, YjsEditorKey, type YDoc } from '@/application/types';

import DocumentDatabase from '../DocumentDatabase';

import type { SourceBlock } from '../types';

const mockOperations = {
  loadView: jest.fn(),
  loadViewMeta: jest.fn(),
  bindViewSync: jest.fn(),
};
let mockPermissions = { canRead: false, hasLoadedViewActionPermissions: false };
let mockDatabaseProps: { openRowInHostPeek?: (...args: never[]) => void } = {};

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => mockOperations,
  useCurrentWorkspaceIdOptional: () => 'workspace',
  useEventEmitterOptional: () => undefined,
  useScheduleDeferredCleanup: () => jest.fn(),
}));
jest.mock('@/components/app/view-actions/useViewActionPermissions', () => ({
  useViewActionPermissions: () => mockPermissions,
}));
jest.mock('@/components/database/Database', () => ({
  __esModule: true,
  default: (props: typeof mockDatabaseProps) => {
    mockDatabaseProps = props;
    return <div>Database view</div>;
  },
}));
jest.mock('@/application/db', () => ({ deleteCollabDB: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/application/services/domains', () => ({
  ViewService: { get: jest.fn(), getTrashCached: jest.fn(), refresh: jest.fn() },
}));

const block: SourceBlock = {
  id: 'embed',
  type: 'grid',
  text: '',
  children: [],
  database: { viewIds: ['view'], databaseId: 'database' },
};

function databaseDoc(viewIds: string[]) {
  const doc = new Y.Doc({ guid: 'database' }) as YDoc;
  const database = new Y.Map();
  const views = new Y.Map();

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.views, views);
  viewIds.forEach((id) => views.set(id, new Y.Map()));
  return doc;
}

const status = () => screen.getByRole('status').textContent;

beforeEach(() => {
  jest.clearAllMocks();
  mockDatabaseProps = {};
  mockOperations.loadViewMeta.mockResolvedValue({ view_id: 'view', name: 'Tasks' });
  mockOperations.bindViewSync.mockReturnValue(null);
});

test('never fetches, opens or syncs a database before read access is confirmed', async () => {
  const doc = databaseDoc(['view']);
  const present = () => <DocumentDatabase block={block} onSource={jest.fn()} />;

  mockPermissions = { canRead: false, hasLoadedViewActionPermissions: false };
  mockOperations.loadView.mockResolvedValue(doc);
  const { rerender } = render(present());

  expect(status()).toBe('Loading database view…');
  mockPermissions = { canRead: false, hasLoadedViewActionPermissions: true };
  rerender(present());
  expect(status()).toContain('You don’t have access to this linked database.');
  await act(async () => undefined);
  expect(mockOperations.loadView).not.toHaveBeenCalled();
  expect(mockOperations.loadViewMeta).not.toHaveBeenCalled();
  expect(mockOperations.bindViewSync).not.toHaveBeenCalled();

  mockPermissions = { canRead: true, hasLoadedViewActionPermissions: true };
  rerender(present());
  await screen.findByText('Database view');
  expect(mockOperations.loadView).toHaveBeenCalledTimes(1);
  expect(mockOperations.bindViewSync).toHaveBeenCalledWith(doc, { retain: true });
});

test('shows the view when the database and its views sync after the document loads', async () => {
  const doc = new Y.Doc({ guid: 'database' }) as YDoc;
  const error = jest.spyOn(console, 'error');

  mockPermissions = { canRead: true, hasLoadedViewActionPermissions: true };
  mockOperations.loadView.mockResolvedValue(doc);
  const { unmount } = render(<DocumentDatabase block={block} onSource={jest.fn()} />);

  await waitFor(() => expect(status()).toContain('no longer available'));
  const database = new Y.Map();
  const views = new Y.Map();

  act(() => {
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  });
  act(() => {
    database.set(YjsDatabaseKey.views, views);
  });
  expect(status()).toContain('no longer available');
  act(() => {
    views.set('view', new Y.Map());
  });
  expect(screen.getByText('Database view')).toBeTruthy();
  unmount();
  expect(error).not.toHaveBeenCalledWith(expect.stringContaining('[yjs]'));
  error.mockRestore();
});

test('keeps one row-opening callback for the database context and follows the latest source handler', async () => {
  const first = jest.fn();
  const second = jest.fn();

  mockPermissions = { canRead: true, hasLoadedViewActionPermissions: true };
  mockOperations.loadView.mockResolvedValue(databaseDoc(['view']));
  const { rerender } = render(<DocumentDatabase block={block} onSource={first} />);

  await screen.findByText('Database view');
  const stable = mockDatabaseProps.openRowInHostPeek;

  rerender(<DocumentDatabase block={block} onSource={second} />);
  expect(mockDatabaseProps.openRowInHostPeek).toBe(stable);
  stable!();
  expect(second).toHaveBeenCalledWith('embed');
  expect(first).not.toHaveBeenCalled();
});
