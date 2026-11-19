import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

const mockLoadView = jest.fn();
const mockBindViewSync = jest.fn((doc: Y.Doc) => ({ doc }));
const mockScheduleDeferredCleanup = jest.fn();
const mockRestorePage = jest.fn();
const mockDeleteTrash = jest.fn();
const mockLoadTrash = jest.fn();
const mockNotifyError = jest.fn();
const firstRow = { view_id: 'row-page-id', name: 'Row page', created_at: 1, last_edited_time: 1 };
let mockTrashRows = [firstRow];

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-id',
  useScheduleDeferredCleanup: () => mockScheduleDeferredCleanup,
  useAppTrash: () => ({
    trashList: mockTrashRows,
    loadTrash: mockLoadTrash,
  }),
  useAppOperations: () => ({
    restorePage: mockRestorePage,
    deleteTrash: mockDeleteTrash,
    loadView: mockLoadView,
    bindViewSync: mockBindViewSync,
  }),
}));

jest.mock('@/application/row-document/lifecycle', () => ({
  getRowDocumentSourceFromView: (view: { view_id: string }) => ({
    database_id: 'database-id',
    database_view_id: 'database-view-id',
    row_id: view.view_id,
  }),
}));

jest.mock('@/application/database-yjs/dispatch/row-lifecycle', () => ({
  removeRowsFromDatabase: jest.fn(),
  restoreSoftDeletedRowsInDatabase: jest.fn(),
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: {
    error: mockNotifyError,
  },
}));

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({ open, onOk }: { open: boolean; onOk: () => void }) =>
    open ? (
      <button data-testid='confirm-permanent-delete' onClick={onOk}>
        confirm
      </button>
    ) : null,
}));

jest.mock('@/components/_shared/skeleton/TableSkeleton', () => ({
  __esModule: true,
  default: () => null,
}));

import {
  removeRowsFromDatabase,
  restoreSoftDeletedRowsInDatabase,
} from '@/application/database-yjs/dispatch/row-lifecycle';
import { getOrCreateDatabaseHistoryManager, runDatabaseAction } from '@/application/database-yjs/history';
import { YDatabase, YjsEditorKey, YSharedRoot } from '@/application/types';
import TrashPage from '@/pages/TrashPage';

const capturedMarkerKey = 'captured-history-marker';
const trashMarkerKey = 'trash-lifecycle-marker';

function createDatabaseFixture() {
  const doc = new Y.Doc();
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = new Y.Map() as YDatabase;

  sharedRoot.set(YjsEditorKey.database, database);
  return { database, doc, sharedRoot };
}

function createRedoState(doc: Y.Doc, sharedRoot: YSharedRoot) {
  const history = getOrCreateDatabaseHistoryManager(doc);

  runDatabaseAction(doc, { type: 'database.test-marker' }, () => {
    sharedRoot.set(capturedMarkerKey, true);
  });
  history.undo();

  expect(sharedRoot.has(capturedMarkerKey)).toBe(false);
  expect(history.canUndo()).toBe(false);
  expect(history.canRedo()).toBe(true);
  return history;
}

function createTrackedLifecycleMutation(marker: string) {
  return (sharedRoot: YSharedRoot, database: YDatabase) => {
    const doc = sharedRoot.doc;

    if (!doc) throw new Error('database document not found');

    // Production row-lifecycle helpers use the same nested history wrapper.
    // The TrashPage's outer skip transaction must take precedence over it.
    runDatabaseAction(doc, { type: 'database.test-trash-row-lifecycle' }, () => {
      database.set(trashMarkerKey, marker);
    });
  };
}

describe('TrashPage row lifecycle ordering', () => {
  beforeEach(() => {
    mockTrashRows = [firstRow];
    jest.clearAllMocks();
    jest.mocked(removeRowsFromDatabase).mockReset();
    jest.mocked(restoreSoftDeletedRowsInDatabase).mockReset();
    mockLoadView.mockRejectedValue(new Error('database unavailable'));
  });

  it.each(['restore', 'delete'] as const)('retains a single database binding through bulk %s', async (action) => {
    const { doc } = createDatabaseFixture();
    const folderAction = action === 'restore' ? mockRestorePage : mockDeleteTrash;
    const mutate = action === 'restore' ? restoreSoftDeletedRowsInDatabase : removeRowsFromDatabase;
    let finishFolder!: () => void;

    mockTrashRows = [firstRow, { ...firstRow, view_id: 'other-row-page' }];
    mockLoadView.mockResolvedValue(doc);
    folderAction.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFolder = resolve; }));
    render(<TrashPage />);
    fireEvent.click(screen.getByText(action === 'restore' ? 'trash.restoreAll' : 'trash.deleteAll'));
    if (action === 'delete') fireEvent.click(await screen.findByTestId('confirm-permanent-delete'));

    await waitFor(() => expect(folderAction).toHaveBeenCalledWith(undefined));
    expect(mockLoadView).toHaveBeenCalledTimes(1);
    expect(mockBindViewSync).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(jest.mocked(mutate).mock.calls[0]?.[2]).toEqual(['row-page-id', 'other-row-page']);
    expect(mockScheduleDeferredCleanup).not.toHaveBeenCalled();
    finishFolder();
    await waitFor(() => expect(mockScheduleDeferredCleanup).toHaveBeenCalledWith(doc.guid));
    expect(mockScheduleDeferredCleanup).toHaveBeenCalledTimes(1);
  });

  it('keeps the Trash entry when loading the database for restore fails', async () => {
    render(<TrashPage />);

    fireEvent.click(screen.getByTestId('trash-restore-button'));

    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalledWith('Failed to restore page: database unavailable');
    });
    expect(mockRestorePage).not.toHaveBeenCalled();
    expect(mockScheduleDeferredCleanup).not.toHaveBeenCalled();
  });

  it('keeps the Trash entry when the permanent-delete database mutation fails', async () => {
    const doc = new Y.Doc();

    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, new Y.Map());
    mockLoadView.mockResolvedValue(doc);
    jest.mocked(removeRowsFromDatabase).mockImplementation(() => {
      throw new Error('database mutation failed');
    });

    render(<TrashPage />);

    fireEvent.click(screen.getByTestId('trash-delete-button'));
    fireEvent.click(await screen.findByTestId('confirm-permanent-delete'));

    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalledWith('Failed to delete page: database mutation failed');
    });
    expect(mockDeleteTrash).not.toHaveBeenCalled();
    expect(mockScheduleDeferredCleanup).toHaveBeenCalledWith(doc.guid);
  });

  it('restores a row from global Trash without adding history or clearing redo', async () => {
    const { database, doc, sharedRoot } = createDatabaseFixture();
    const history = createRedoState(doc, sharedRoot);

    mockLoadView.mockResolvedValue(doc);
    jest.mocked(restoreSoftDeletedRowsInDatabase).mockImplementation(createTrackedLifecycleMutation('restored'));

    render(<TrashPage />);

    fireEvent.click(screen.getByTestId('trash-restore-button'));

    await waitFor(() => {
      expect(mockRestorePage).toHaveBeenCalledWith('row-page-id');
    });
    expect(database.get(trashMarkerKey)).toBe('restored');
    expect(mockBindViewSync).toHaveBeenCalledWith(doc, { retain: true });
    expect(mockScheduleDeferredCleanup).toHaveBeenCalledWith(doc.guid);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });

  it('permanently deletes a row from global Trash without adding history or clearing redo', async () => {
    const { database, doc, sharedRoot } = createDatabaseFixture();
    const history = createRedoState(doc, sharedRoot);

    mockLoadView.mockResolvedValue(doc);
    jest.mocked(removeRowsFromDatabase).mockImplementation(createTrackedLifecycleMutation('permanently-deleted'));

    render(<TrashPage />);

    fireEvent.click(screen.getByTestId('trash-delete-button'));
    fireEvent.click(await screen.findByTestId('confirm-permanent-delete'));

    await waitFor(() => {
      expect(mockDeleteTrash).toHaveBeenCalledWith('row-page-id');
    });
    expect(database.get(trashMarkerKey)).toBe('permanently-deleted');
    expect(mockScheduleDeferredCleanup).toHaveBeenCalledWith(doc.guid);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });
});
