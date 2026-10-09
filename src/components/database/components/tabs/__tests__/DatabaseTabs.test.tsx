import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import * as Y from 'yjs';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { DatabaseContextState } from '@/application/database-yjs/context';
import { useDuplicateDatabaseView, useUpdateDatabaseView } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout, UIVariant, View, ViewLayout, YDatabase, YDatabaseView, YDatabaseViews, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { DatabaseTabs } from '@/components/database/components/tabs/DatabaseTabs';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

jest.mock('@/application/database-yjs', () => ({
  useDatabase: jest.fn(),
  useDatabaseContext: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useDuplicateDatabaseView: jest.fn(),
  useUpdateDatabaseView: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'menuAppHeader.pageNameSuffix' ? 'Copy' : key),
  }),
}));

jest.mock('@/components/database/components/conditions', () => ({
  DatabaseActions: () => <div data-testid='database-actions-mock' />,
}));

jest.mock('@/components/database/components/tabs/DatabaseViewTabs', () => ({
  DatabaseViewTabs: ({
    viewNameById,
    setRenameView,
    onDuplicateView,
    duplicateDisabled,
    duplicateDisabledReason,
  }: {
    viewNameById?: Record<string, string>;
    setRenameView: (view: View) => void;
    onDuplicateView?: (viewId: string) => void;
    duplicateDisabled?: boolean;
    duplicateDisabledReason?: string;
  }) => (
    <div data-testid='database-view-tabs'>
      {viewNameById?.['database-view-id'] ?? 'Yjs view name'}
      <button onClick={() => setRenameView(mockNewDatabaseView)}>Rename new view</button>
      <button onClick={() => setRenameView(mockLiveRenameView)}>Rename live view</button>
      {onDuplicateView ? <button disabled={duplicateDisabled} title={duplicateDisabledReason} onClick={() => onDuplicateView(databaseView.view_id)}>Duplicate view</button> : null}
    </div>
  ),
}));

// The phone's view switcher (tested with `MobileDatabaseViewPill`): its props are what matters here.
jest.mock('@/components/database/components/tabs/MobileDatabaseViewPill', () => ({
  MobileDatabaseViewPill: ({
    viewIds,
    selectedViewId,
    readOnly,
    onViewAdded,
  }: {
    viewIds: string[];
    selectedViewId?: string;
    readOnly: boolean;
    onViewAdded?: (viewId: string) => void;
  }) => (
    <div
      data-can-add={String(!readOnly && Boolean(onViewAdded))}
      data-selected={selectedViewId}
      data-testid='database-view-pill'
      data-view-ids={viewIds.join(',')}
    />
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
    (useDuplicateDatabaseView as jest.Mock).mockReturnValue(jest.fn());
    (useUpdateDatabaseView as jest.Mock).mockReturnValue(jest.fn());
    updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), {
      status: 'available', info: { enable_page_history: true },
    });
  });

  it('disables duplication at the raw view cap while preserving rename and re-enables after deletion', async () => {
    const databaseDoc = new Y.Doc() as YDoc;
    const database = new Y.Map() as YDatabase;
    const views = new Y.Map() as YDatabaseViews;

    databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
    database.set(YjsDatabaseKey.views, views);
    for (const id of [databaseView.view_id, 'hidden-owned-view']) {
      views.set(id, new Y.Map() as YDatabaseView);
    }

    const duplicateView = jest.fn().mockResolvedValue('copy');

    (useDatabase as jest.Mock).mockReturnValue(database);
    (useDuplicateDatabaseView as jest.Mock).mockReturnValue(duplicateView);
    (useDatabaseContext as jest.Mock).mockReturnValue({
      databaseDoc, createDatabaseView: jest.fn(), loadViewMeta: jest.fn(async () => databaseContainer),
      readOnly: false, showActions: true,
    } as unknown as DatabaseContextState);
    updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), {
      status: 'available', info: { enable_page_history: true, max_dashboard_widgets: 2 },
    });
    render(<DatabaseTabs databasePageId={databaseView.view_id} viewIds={[databaseView.view_id]} />);
    const duplicate = screen.getByRole('button', { name: 'Duplicate view' });

    expect(duplicate.hasAttribute('disabled')).toBe(true);
    expect(duplicate.getAttribute('title')).toContain('limit of 2 views');
    expect(screen.getByRole('button', { name: 'Rename live view' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(duplicate);
    expect(duplicateView).not.toHaveBeenCalled();
    act(() => views.delete('hidden-owned-view'));
    expect(duplicate.hasAttribute('disabled')).toBe(false);
    fireEvent.click(duplicate);
    await waitFor(() => expect(duplicateView).toHaveBeenCalledTimes(1));
  });

  it('duplicates a tab through the database-view hook and selects the returned view', async () => {
    const duplicatedViewId = 'duplicated-view-id';
    const duplicateView = jest.fn().mockResolvedValue(duplicatedViewId);
    const setSelectedViewId = jest.fn();
    const onViewAddedToDatabase = jest.fn();
    const onViewIdsChanged = jest.fn();
    const onReorderTabs = jest.fn();
    const onBeforeViewAddedToDatabase = jest.fn();
    const onAfterViewAddedToDatabase = jest.fn();
    const sourceYjsView = {
      get: jest.fn((key: YjsDatabaseKey) => (key === YjsDatabaseKey.name ? 'Gallery' : undefined)),
    };
    const views = new Map([[databaseView.view_id, sourceYjsView]]);
    const galleryContainer = {
      ...databaseContainer,
      children: [{ ...databaseView, name: 'Gallery', layout: ViewLayout.Gallery }],
    };

    (useDatabase as jest.Mock).mockReturnValue({
      get: () => views,
    });
    (useDuplicateDatabaseView as jest.Mock).mockReturnValue(duplicateView);
    (useDatabaseContext as jest.Mock).mockReturnValue({
      createDatabaseView: jest.fn(),
      isDocumentBlock: true,
      loadViewMeta: jest.fn(async () => galleryContainer),
      readOnly: false,
      showActions: true,
    } as unknown as DatabaseContextState);

    render(
      <DatabaseTabs
        databasePageId={databaseView.view_id}
        selectedViewId={databaseView.view_id}
        setSelectedViewId={setSelectedViewId}
        viewIds={[databaseView.view_id]}
        onViewAddedToDatabase={onViewAddedToDatabase}
        onViewIdsChanged={onViewIdsChanged}
        onReorderTabs={onReorderTabs}
        onBeforeViewAddedToDatabase={onBeforeViewAddedToDatabase}
        onAfterViewAddedToDatabase={onAfterViewAddedToDatabase}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('database-view-tabs').textContent).toContain('Gallery');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate view' }));

    await waitFor(() => {
      expect(duplicateView).toHaveBeenCalledWith(databaseView.view_id, 'Gallery (Copy)');
      expect(onViewAddedToDatabase).toHaveBeenCalledWith(duplicatedViewId);
      expect(onViewIdsChanged).toHaveBeenCalledWith([duplicatedViewId, databaseView.view_id]);
      expect(onReorderTabs).toHaveBeenCalledWith({
        movedId: duplicatedViewId,
        prevId: null,
        nextIds: [duplicatedViewId, databaseView.view_id],
        fromIndex: 1,
        toIndex: 0,
      });
      expect(setSelectedViewId).toHaveBeenCalledWith(duplicatedViewId);
      expect(onAfterViewAddedToDatabase).toHaveBeenCalledTimes(1);
    });
    expect(onBeforeViewAddedToDatabase).toHaveBeenCalledTimes(1);
  });

  it('duplicates a Form without checking a workspace subscription', async () => {
    const duplicateView = jest.fn().mockResolvedValue('duplicated-view-id');
    const onBeforeViewAddedToDatabase = jest.fn();
    const onAfterViewAddedToDatabase = jest.fn();
    const sourceYjsView = {
      get: jest.fn((key: YjsDatabaseKey) => {
        if (key === YjsDatabaseKey.name) return 'Form';
        if (key === YjsDatabaseKey.layout) return DatabaseViewLayout.Form;
        return undefined;
      }),
    };
    const views = new Map([[databaseView.view_id, sourceYjsView]]);
    const context = {
      createDatabaseView: jest.fn(),
      isDocumentBlock: true,
      loadViewMeta: jest.fn(async () => databaseContainer),
      readOnly: false,
      showActions: true,
    } as unknown as DatabaseContextState;
    const props = {
      databasePageId: databaseView.view_id,
      selectedViewId: databaseView.view_id,
      viewIds: [databaseView.view_id],
      onBeforeViewAddedToDatabase,
      onAfterViewAddedToDatabase,
    };

    (useDatabase as jest.Mock).mockReturnValue({ get: () => views });
    (useDuplicateDatabaseView as jest.Mock).mockReturnValue(duplicateView);
    (useDatabaseContext as jest.Mock).mockReturnValue(context);

    render(<DatabaseTabs {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate view' }));

    await waitFor(() => expect(duplicateView).toHaveBeenCalledWith(databaseView.view_id, 'Form (Copy)'));
    expect(onBeforeViewAddedToDatabase).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onAfterViewAddedToDatabase).toHaveBeenCalledTimes(1));
  });

  it('shows the plan rejection when duplicating a Timeline view', async () => {
    const message = 'Creating a Timeline view requires a Pro workspace.';
    const duplicateView = jest.fn().mockRejectedValue({ code: 1090, message });
    const onBeforeViewAddedToDatabase = jest.fn();
    const onAfterViewAddedToDatabase = jest.fn();
    const sourceYjsView = {
      get: jest.fn((key: YjsDatabaseKey) => {
        if (key === YjsDatabaseKey.name) return 'Timeline';
        if (key === YjsDatabaseKey.layout) return DatabaseViewLayout.Timeline;
        return undefined;
      }),
    };
    const views = new Map([[databaseView.view_id, sourceYjsView]]);
    const context = {
      createDatabaseView: jest.fn(),
      isDocumentBlock: true,
      loadViewMeta: jest.fn(async () => databaseContainer),
      readOnly: false,
      showActions: true,
    } as unknown as DatabaseContextState;
    const props = {
      databasePageId: databaseView.view_id,
      selectedViewId: databaseView.view_id,
      viewIds: [databaseView.view_id],
      onBeforeViewAddedToDatabase,
      onAfterViewAddedToDatabase,
    };

    (useDatabase as jest.Mock).mockReturnValue({ get: () => views });
    (useDuplicateDatabaseView as jest.Mock).mockReturnValue(duplicateView);
    (useDatabaseContext as jest.Mock).mockReturnValue(context);

    render(<DatabaseTabs {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate view' }));

    await waitFor(() => expect(duplicateView).toHaveBeenCalledWith(databaseView.view_id, 'Timeline (Copy)'));
    expect(toast.error).toHaveBeenCalledWith(message);
    expect(toast.success).not.toHaveBeenCalled();
    expect(onBeforeViewAddedToDatabase).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onAfterViewAddedToDatabase).toHaveBeenCalledTimes(1));
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

  it('marks the whole tab row, view tabs and toolbar, as the visual parity content column', async () => {
    (useDatabaseContext as jest.Mock).mockReturnValue({
      loadViewMeta: jest.fn(async () => null),
      readOnly: false,
      showActions: true,
    } as DatabaseContextState);

    const { container } = render(
      <DatabaseTabs
        databasePageId={databaseView.view_id}
        selectedViewId={databaseView.view_id}
        viewIds={[databaseView.view_id]}
      />
    );

    const columns = container.querySelectorAll('[data-parity-id="dash-content-column"]');

    expect(columns).toHaveLength(1);
    // Same box as desktop's TabBarHeader: the strip and the toolbar beside it.
    expect(columns[0].contains(screen.getByTestId('database-view-tabs'))).toBe(true);
    expect(columns[0].contains(screen.getByTestId('database-actions-container'))).toBe(true);
    await waitFor(() => expect(screen.getByTestId('database-actions-mock')).toBeTruthy());
  });

  it('passes outline names for views loaded in Yjs (folder names are the source of truth, like desktop)', async () => {
    // Desktop renames only update the folder view; the database collab keeps
    // its creation-time layout default ("Grid"). The outline name must win
    // even when the view's collab is loaded.
    const views = new Map([[databaseView.view_id, {}]]);
    const renamedContainer: View = {
      ...databaseContainer,
      children: [{ ...databaseView, name: 'kkk' }],
    };

    (useDatabase as jest.Mock).mockReturnValue({
      get: () => views,
    });
    (useDatabaseContext as jest.Mock).mockReturnValue({
      isDocumentBlock: true,
      loadViewMeta: jest.fn(async () => renamedContainer),
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
      expect(screen.getByTestId('database-view-tabs').textContent).toContain('kkk');
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
    expect(screen.getByTestId('database-actions-mock')).toBeTruthy();
    expect(screen.getByTestId('database-actions-container').style.opacity).toBe('1');
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

  // WP14 W-11: below 768px a view pill replaces the tab strip; the toolbar stays at the right.
  describe('in a mobile context (a 390px window)', () => {
    const initialWidth = window.innerWidth;

    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
    });

    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: initialWidth });
    });

    it('renders the view pill instead of the tabs, and keeps the actions', () => {
      (useDatabaseContext as jest.Mock).mockReturnValue({
        createDatabaseView: jest.fn(),
        isDocumentBlock: false,
        loadViewMeta: jest.fn(async () => databaseContainer),
        readOnly: false,
        showActions: true,
      } as unknown as DatabaseContextState);

      render(
        <DatabaseTabs
          databasePageId={databaseView.view_id}
          selectedViewId='view-b'
          setSelectedViewId={jest.fn()}
          viewIds={['view-a', 'view-b']}
        />
      );

      const pill = screen.getByTestId('database-view-pill');

      expect(screen.queryByTestId('database-view-tabs')).toBeNull();
      expect(pill.getAttribute('data-view-ids')).toBe('view-a,view-b');
      expect(pill.getAttribute('data-selected')).toBe('view-b');
      expect(pill.getAttribute('data-can-add')).toBe('true');
      expect(screen.getByTestId('database-actions-mock')).toBeTruthy();
    });

    it('keeps the tab strip at 768px', () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 768 });
      (useDatabaseContext as jest.Mock).mockReturnValue({
        isDocumentBlock: false,
        loadViewMeta: jest.fn(async () => databaseContainer),
        readOnly: false,
        showActions: true,
      } as unknown as DatabaseContextState);

      render(<DatabaseTabs databasePageId={databaseView.view_id} viewIds={[databaseView.view_id]} />);

      expect(screen.getByTestId('database-view-tabs')).toBeTruthy();
      expect(screen.queryByTestId('database-view-pill')).toBeNull();
    });
  });
});
