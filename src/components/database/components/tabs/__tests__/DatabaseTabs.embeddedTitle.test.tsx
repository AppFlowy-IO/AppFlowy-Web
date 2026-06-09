import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { useUpdateDatabaseView } from '@/application/database-yjs/dispatch';
import { View, ViewLayout } from '@/application/types';

import { DatabaseTabs } from '../DatabaseTabs';

jest.mock('@/application/database-yjs', () => ({
  useDatabase: jest.fn(),
  useDatabaseContext: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateDatabaseView: jest.fn(),
}));

jest.mock('@/components/database/components/tabs/DatabaseViewTabs', () => ({
  DatabaseViewTabs: ({ viewIds, viewNameById }: { viewIds: string[]; viewNameById?: Record<string, string> }) => (
    <div data-testid='database-view-tabs'>
      {viewIds.map((viewId) => (
        <span key={viewId}>{viewNameById?.[viewId] ?? viewId}</span>
      ))}
    </div>
  ),
}));

jest.mock('@/components/database/components/conditions', () => ({
  DatabaseActions: () => <div data-testid='database-actions' />,
}));

jest.mock('@/components/app/view-actions/RenameModal', () => ({
  __esModule: true,
  default: ({
    open,
    view,
    viewId,
    updatePage,
  }: {
    open: boolean;
    view: View;
    viewId: string;
    updatePage: (viewId: string, payload: { name: string; icon: unknown; extra: unknown }) => Promise<void>;
  }) =>
    open ? (
      <div data-testid='rename-modal'>
        {viewId}:{view.name}
        <button
          type='button'
          data-testid='rename-modal-save'
          onClick={() =>
            updatePage(viewId, {
              name: 'Renamed Database',
              icon: view.icon,
              extra: view.extra,
            })
          }
        />
      </div>
    ) : null,
}));

jest.mock('@/components/database/components/tabs/DeleteViewConfirm', () => ({
  __esModule: true,
  default: () => null,
}));

const mockUseDatabase = useDatabase as jest.MockedFunction<typeof useDatabase>;
const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
const mockUseUpdateDatabaseView = useUpdateDatabaseView as jest.MockedFunction<typeof useUpdateDatabaseView>;

const createView = (overrides: Partial<View> & Pick<View, 'view_id' | 'name'>): View => ({
  view_id: overrides.view_id,
  name: overrides.name,
  icon: null,
  layout: ViewLayout.Grid,
  extra: null,
  children: [],
  is_published: false,
  is_private: false,
  ...overrides,
});

describe('DatabaseTabs embedded title', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDatabase.mockReturnValue({ get: jest.fn() } as never);
  });

  it('renders the database container name for document blocks', async () => {
    const updateDatabaseView = jest.fn();
    const updatePage = jest.fn();
    const childView = createView({
      view_id: 'grid-view-id',
      name: 'Grid',
      parent_view_id: 'container-view-id',
      extra: {
        database_id: 'database-id',
      },
    });
    const containerView = createView({
      view_id: 'container-view-id',
      name: 'New Database',
      children: [childView],
      extra: {
        database_id: 'database-id',
        is_database_container: true,
      },
    });
    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === childView.view_id) return childView;
      if (viewId === containerView.view_id) return containerView;
      return null;
    });

    mockUseUpdateDatabaseView.mockReturnValue(updateDatabaseView as never);
    mockUseDatabaseContext.mockReturnValue({
      readOnly: false,
      databasePageId: childView.view_id,
      activeViewId: childView.view_id,
      workspaceId: 'workspace-id',
      loadViewMeta,
      updatePage,
      isDocumentBlock: true,
      showActions: false,
    } as never);

    render(
      <DatabaseTabs
        databasePageId={childView.view_id}
        selectedViewId={childView.view_id}
        viewIds={[childView.view_id]}
      />
    );

    const title = await screen.findByRole('button', { name: 'New Database' });

    expect(loadViewMeta).toHaveBeenCalledWith(childView.view_id);
    expect(loadViewMeta).toHaveBeenCalledWith(containerView.view_id);
    expect(screen.getByTestId('database-view-tabs').textContent).toContain('Grid');

    fireEvent.click(title);

    await waitFor(() => {
      expect(screen.getByTestId('rename-modal').textContent).toBe('container-view-id:New Database');
    });

    fireEvent.click(screen.getByTestId('rename-modal-save'));

    await waitFor(() => {
      expect(updatePage).toHaveBeenCalledWith(
        containerView.view_id,
        expect.objectContaining({
          name: 'Renamed Database',
        })
      );
    });
    expect(updateDatabaseView).not.toHaveBeenCalled();
  });
});
