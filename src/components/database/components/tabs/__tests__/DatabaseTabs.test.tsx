import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { useUpdateDatabaseView } from '@/application/database-yjs/dispatch';
import { DatabaseContextState } from '@/application/database-yjs/context';
import { UIVariant, View, ViewLayout } from '@/application/types';
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
  DatabaseViewTabs: ({
    viewNameById,
    setRenameView,
  }: {
    viewNameById?: Record<string, string>;
    setRenameView: (view: View) => void;
  }) => (
    <div data-testid='database-view-tabs'>
      {viewNameById?.['database-view-id'] ?? 'Yjs view name'}
      <button onClick={() => setRenameView(mockNewDatabaseView)}>Rename new view</button>
      <button onClick={() => setRenameView(mockLiveRenameView)}>Rename live view</button>
    </div>
  ),
}));

jest.mock('@/components/app/view-actions/RenameModal', () => ({
  __esModule: true,
  default: ({ view }: { view: { name: string } }) => <div data-testid='rename-modal'>{view.name}</div>,
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

const mockNewDatabaseView: View = {
  ...databaseView,
  view_id: 'new-database-view-id',
  name: 'Board',
  layout: ViewLayout.Board,
};

// Same view as in outline meta, but carrying the live (Yjs) tab name.
const mockLiveRenameView: View = {
  ...databaseView,
  name: 'Live Grid',
};

describe('DatabaseTabs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useDatabase as jest.Mock).mockReturnValue(undefined);
    (useUpdateDatabaseView as jest.Mock).mockReturnValue(jest.fn());
  });

  it('renders the database container name for an embedded database', async () => {
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
    } as DatabaseContextState);

    render(
      <DatabaseTabs
        databasePageId={databaseView.view_id}
        selectedViewId={databaseView.view_id}
        viewIds={[databaseView.view_id]}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('embedded-database-title').textContent).toBe('New Database');
    });
  });

  it('does not let stale outline metadata override a loaded Yjs view name', async () => {
    const views = new Map<string, object>();

    (useDatabase as jest.Mock).mockReturnValue({
      get: () => views,
    });
    (useDatabaseContext as jest.Mock).mockReturnValue({
      isDocumentBlock: true,
      loadViewMeta: jest.fn(async () => databaseContainer),
      readOnly: false,
      showActions: true,
    } as DatabaseContextState);

    const tabs = (
      <DatabaseTabs
        databasePageId={databaseView.view_id}
        selectedViewId={databaseView.view_id}
        viewIds={[databaseView.view_id]}
      />
    );
    const { rerender } = render(tabs);

    await waitFor(() => {
      expect(screen.getByTestId('database-view-tabs').textContent).toContain('Grid');
    });

    views.set(databaseView.view_id, {});
    rerender(
      <DatabaseTabs
        databasePageId={databaseView.view_id}
        selectedViewId={databaseView.view_id}
        viewIds={[databaseView.view_id]}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('database-view-tabs').textContent).toContain('Yjs view name');
    });
  });

  it('preserves outline name overrides for published database tabs', async () => {
    const views = new Map([[databaseView.view_id, {}]]);

    (useDatabase as jest.Mock).mockReturnValue({
      get: () => views,
    });
    (useDatabaseContext as jest.Mock).mockReturnValue({
      isDocumentBlock: true,
      loadViewMeta: jest.fn(async () => databaseContainer),
      readOnly: true,
      showActions: false,
      variant: UIVariant.Publish,
    } as DatabaseContextState);

    render(
      <DatabaseTabs
        databasePageId={databaseView.view_id}
        selectedViewId={databaseView.view_id}
        viewIds={[databaseView.view_id]}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('database-view-tabs').textContent).toContain('Grid');
    });
  });

  it('opens rename from the action view when a newly created view is not in the current caches', async () => {
    const views = new Map([[databaseView.view_id, {}]]);
    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === databaseView.view_id) return databaseView;
      if (viewId === databaseContainer.view_id) return databaseContainer;
      return null;
    });

    (useDatabase as jest.Mock).mockReturnValue({
      get: () => views,
    });
    (useDatabaseContext as jest.Mock).mockReturnValue({
      isDocumentBlock: true,
      loadViewMeta,
      readOnly: false,
      showActions: true,
    } as DatabaseContextState);

    render(
      <DatabaseTabs
        databasePageId={databaseView.view_id}
        selectedViewId={databaseView.view_id}
        viewIds={[databaseView.view_id, mockNewDatabaseView.view_id]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename new view' }));

    await waitFor(() => {
      expect(screen.getByTestId('rename-modal').textContent).toBe('Board');
    });
  });

  it('prefills rename with the live tab name even when outline meta lags behind', async () => {
    const views = new Map([[databaseView.view_id, {}]]);
    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === databaseView.view_id) return databaseView;
      if (viewId === databaseContainer.view_id) return databaseContainer;
      return null;
    });

    (useDatabase as jest.Mock).mockReturnValue({
      get: () => views,
    });
    (useDatabaseContext as jest.Mock).mockReturnValue({
      isDocumentBlock: true,
      loadViewMeta,
      readOnly: false,
      showActions: true,
    } as DatabaseContextState);

    render(
      <DatabaseTabs
        databasePageId={databaseView.view_id}
        selectedViewId={databaseView.view_id}
        viewIds={[databaseView.view_id]}
      />
    );

    // Wait for meta to commit (the embedded title renders from it) so the
    // rename handler resolves the outline entry, which still carries the
    // stale name 'Grid'.
    await waitFor(() => {
      expect(screen.getByTestId('embedded-database-title')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Rename live view' }));

    await waitFor(() => {
      expect(screen.getByTestId('rename-modal').textContent).toBe('Live Grid');
    });
  });
});
