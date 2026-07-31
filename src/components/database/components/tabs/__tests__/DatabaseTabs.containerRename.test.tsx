import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { useUpdateDatabaseView } from '@/application/database-yjs/dispatch';
import { DatabaseContextState } from '@/application/database-yjs/context';
import { UpdatePagePayload, View, ViewLayout } from '@/application/types';
import { DatabaseTabs } from '@/components/database/components/tabs/DatabaseTabs';

jest.mock('@/application/database-yjs', () => ({
  useDatabase: jest.fn(),
  useDatabaseContext: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateDatabaseView: jest.fn(),
}));

jest.mock('@/components/database/components/conditions', () => ({
  DatabaseActions: () => null,
}));

jest.mock('@/components/database/components/tabs/DatabaseViewTabs', () => ({
  DatabaseViewTabs: () => null,
}));

jest.mock('@/components/app/view-actions/RenameModal', () => ({
  __esModule: true,
  default: ({
    view,
    viewId,
    updatePage,
  }: {
    view: Pick<View, 'name'>;
    viewId: string;
    updatePage: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
  }) => (
    <>
      <span data-testid='rename-target-name'>{view.name}</span>
      <button
        data-testid='save-container-rename'
        onClick={() =>
          void updatePage(viewId, {
            name: 'Renamed Database',
          })
        }
      >
        Save rename
      </button>
    </>
  ),
}));

jest.mock('@/components/database/components/tabs/DeleteViewConfirm', () => () => null);

const databaseView: View = {
  view_id: 'database-view-id',
  parent_view_id: 'database-container-id',
  name: 'Grid',
  layout: ViewLayout.Grid,
  children: [],
  icon: null,
  extra: {
    database_id: 'database-id',
    embedded: true,
  },
  is_published: false,
  is_private: false,
};

const databaseContainer: View = {
  view_id: 'database-container-id',
  parent_view_id: 'row-document-id',
  name: 'New Database',
  layout: ViewLayout.Grid,
  children: [databaseView],
  icon: null,
  extra: {
    database_id: 'database-id',
    embedded: true,
    is_database_container: true,
  },
  is_published: false,
  is_private: false,
};

describe('DatabaseTabs embedded database title rename', () => {
  const updateDatabaseView = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useDatabase as jest.Mock).mockReturnValue(undefined);
    (useUpdateDatabaseView as jest.Mock).mockReturnValue(updateDatabaseView);
  });

  it('renames the database container instead of the selected tab', async () => {
    const updateContainerPage = jest.fn().mockResolvedValue(undefined);
    const eventEmitter = new EventEmitter();
    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === databaseView.view_id) return databaseView;
      if (viewId === databaseContainer.view_id) return databaseContainer;
      return null;
    });

    (useDatabaseContext as jest.Mock).mockReturnValue({
      isDocumentBlock: true,
      loadViewMeta,
      readOnly: false,
      showActions: true,
      updatePage: updateContainerPage,
      eventEmitter,
    } as DatabaseContextState);

    render(
      <DatabaseTabs
        databasePageId={databaseView.view_id}
        selectedViewId={databaseView.view_id}
        viewIds={[databaseView.view_id]}
      />
    );

    const title = await screen.findByTestId('embedded-database-title-rename');

    fireEvent.click(title);
    expect(screen.getByTestId('rename-target-name').textContent).toBe('New Database');
    fireEvent.click(screen.getByTestId('save-container-rename'));

    await waitFor(() => {
      expect(updateContainerPage).toHaveBeenCalledWith(databaseContainer.view_id, {
        name: 'Renamed Database',
      });
      expect(screen.getByTestId('embedded-database-title').textContent).toBe('Renamed Database');
    });

    expect(updateDatabaseView).not.toHaveBeenCalled();

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, [databaseContainer]);
    });

    expect(screen.getByTestId('embedded-database-title').textContent).toBe('Renamed Database');

    const renamedContainer = { ...databaseContainer, name: 'Renamed Database' };

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.VIEW_META_CHANGED, renamedContainer);
    });

    expect(screen.getByTestId('rename-target-name').textContent).toBe('Renamed Database');

    const remotelyRenamedContainer = { ...databaseContainer, name: 'Remote Database' };

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.VIEW_META_CHANGED, remotelyRenamedContainer);
    });

    expect(screen.getByTestId('embedded-database-title').textContent).toBe('Remote Database');
    expect(screen.getByTestId('rename-target-name').textContent).toBe('Remote Database');
  });

  it('keeps an untitled database renameable', async () => {
    const untitledContainer = { ...databaseContainer, name: '   ' };
    const updateContainerPage = jest.fn().mockResolvedValue(undefined);
    const eventEmitter = new EventEmitter();
    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === databaseView.view_id) return databaseView;
      if (viewId === untitledContainer.view_id) return untitledContainer;
      return null;
    });

    (useDatabaseContext as jest.Mock).mockReturnValue({
      isDocumentBlock: true,
      loadViewMeta,
      readOnly: false,
      showActions: true,
      updatePage: updateContainerPage,
      eventEmitter,
    } as DatabaseContextState);

    render(
      <DatabaseTabs
        databasePageId={databaseView.view_id}
        selectedViewId={databaseView.view_id}
        viewIds={[databaseView.view_id]}
      />
    );

    const title = await screen.findByTestId('embedded-database-title-rename');

    expect(title.textContent).toBe('untitled');
    fireEvent.click(title);
    expect(screen.getByTestId('rename-target-name').textContent).toBe('   ');
  });
});
