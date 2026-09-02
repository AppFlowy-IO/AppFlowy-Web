import { expect } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import * as Y from 'yjs';

import { ERROR_CODE } from '@/application/constants';
import { View, ViewLayout, ViewMetaProps, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import DatabaseView from '@/components/app/DatabaseView';

declare global {
  // eslint-disable-next-line no-var
  var __databaseViewTestState:
    | {
        outline?: View[];
        breadcrumbs?: View[];
        capturedDatabaseProps?: unknown;
        capturedViewMetaProps?: unknown;
        refreshOutline?: jest.Mock;
        ensureViewVisibleInOutline?: jest.Mock;
        getDatabaseContainerUpgradeStatus?: jest.Mock;
        upgradeDatabaseContainer?: jest.Mock;
      }
    | undefined;
}

jest.mock('@/components/app/app.hooks', () => ({
  useAppOutline: () => global.__databaseViewTestState?.outline,
  useBreadcrumb: () => global.__databaseViewTestState?.breadcrumbs,
  useCurrentWorkspaceIdOptional: () => 'test-workspace',
  useEnsureViewVisibleInOutline: () => global.__databaseViewTestState?.ensureViewVisibleInOutline,
  useRefreshOutline: () => global.__databaseViewTestState?.refreshOutline,
}));

jest.mock('@/application/services/domains', () => ({
  PageService: {
    moveTo: jest.fn(),
    getDatabaseContainerUpgradeStatus: (...args: unknown[]) =>
      global.__databaseViewTestState?.getDatabaseContainerUpgradeStatus?.(...args) ??
      Promise.resolve({ eligible: false, already_upgraded: false }),
    upgradeDatabaseContainer: (...args: unknown[]) =>
      global.__databaseViewTestState?.upgradeDatabaseContainer?.(...args),
  },
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/log', () => ({ Log: { warn: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

jest.mock('@/components/database', () => ({
  Database: (props: unknown) => {
    global.__databaseViewTestState = {
      ...(global.__databaseViewTestState || {}),
      capturedDatabaseProps: props,
    };
    return null;
  },
}));

jest.mock('src/components/view-meta/ViewMetaPreview', () => (props: unknown) => {
  global.__databaseViewTestState = {
    ...(global.__databaseViewTestState || {}),
    capturedViewMetaProps: props,
  };
  return null;
});

function createDatabaseDoc(databaseId: string, viewIds: string[] = ['default-view'], inlineViewId = viewIds[0]): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();

  database.set(YjsDatabaseKey.id, databaseId);

  // Add views map with at least one view so hasViews check passes
  const views = new Y.Map();

  viewIds.forEach((viewId) => {
    const view = new Y.Map();

    view.set(YjsDatabaseKey.id, viewId);
    views.set(viewId, view);
  });
  database.set(YjsDatabaseKey.views, views);
  const metas = new Y.Map();

  metas.set(YjsDatabaseKey.iid, inlineViewId);
  database.set(YjsDatabaseKey.metas, metas);

  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

function createLegacyDatabaseView(viewId: string, embedded = false): View {
  return {
    view_id: viewId,
    name: 'Legacy database',
    icon: null,
    layout: ViewLayout.Grid,
    extra: { is_space: false, embedded },
    children: [],
    is_published: false,
    is_private: false,
    parent_view_id: 'general-space-id',
  };
}

function createParentView(child: View): View {
  return {
    view_id: 'general-space-id',
    name: 'General',
    icon: null,
    layout: ViewLayout.Document,
    extra: { is_space: true },
    children: [child],
    has_children: true,
    is_published: false,
    is_private: false,
  };
}

describe('DatabaseView database container', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.__databaseViewTestState = undefined;
  });

  it('uses container for page meta and container children for visibleViewIds', () => {
    const containerId = 'container-id';
    const gridViewId = 'grid-view-id';
    const boardViewId = 'board-view-id';

    const gridView: View = {
      view_id: gridViewId,
      name: 'Grid',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
      parent_view_id: containerId,
    };

    const boardView: View = {
      view_id: boardViewId,
      name: 'Board',
      icon: null,
      layout: ViewLayout.Board,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
      parent_view_id: containerId,
    };

    const containerView: View = {
      view_id: containerId,
      name: 'New Database',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false, is_database_container: true },
      children: [gridView, boardView],
      is_published: false,
      is_private: false,
    };

    global.__databaseViewTestState = { outline: [containerView] };

    const viewMeta: ViewMetaProps = {
      viewId: gridViewId,
      name: gridView.name,
      layout: gridView.layout,
      icon: gridView.icon || undefined,
      extra: gridView.extra,
      workspaceId: 'workspace-id',
      visibleViewIds: [],
    };

    render(
      <MemoryRouter initialEntries={['/app/workspace-id/grid-view-id']}>
        <DatabaseView
          doc={createDatabaseDoc('db-1', [gridViewId, boardViewId])}
          workspaceId={'workspace-id'}
          readOnly={false}
          viewMeta={viewMeta}
          updatePage={jest.fn()}
          updatePageIcon={jest.fn()}
          updatePageName={jest.fn()}
          onRendered={jest.fn()}
        />
      </MemoryRouter>
    );

    const databaseProps = global.__databaseViewTestState?.capturedDatabaseProps as
      | { visibleViewIds: string[]; databaseName: string }
      | undefined;
    const metaProps = global.__databaseViewTestState?.capturedViewMetaProps as
      | { viewId?: string; name?: string }
      | undefined;

    expect(databaseProps).toBeDefined();
    expect(metaProps).toBeDefined();

    // Tab bar should only show container's child views (tabs).
    expect(databaseProps?.visibleViewIds).toEqual([gridViewId, boardViewId]);

    // Database should use the container's name (page-level naming).
    expect(databaseProps?.databaseName).toBe('New Database');

    // Page meta preview should target the container for rename/icon updates.
    expect(metaProps?.viewId).toBe(containerId);
    expect(metaProps?.name).toBe('New Database');
  });

  it('uses the first visible child as the active view when the route opens a database container', () => {
    const containerId = 'container-id';
    const gridViewId = 'grid-view-id';
    const boardViewId = 'board-view-id';

    const gridView: View = {
      view_id: gridViewId,
      name: 'Grid',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
      parent_view_id: containerId,
    };

    const boardView: View = {
      view_id: boardViewId,
      name: 'Board',
      icon: null,
      layout: ViewLayout.Board,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
      parent_view_id: containerId,
    };

    const containerView: View = {
      view_id: containerId,
      name: 'New Database',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false, is_database_container: true },
      children: [gridView, boardView],
      is_published: false,
      is_private: false,
    };

    global.__databaseViewTestState = { outline: [containerView] };

    const viewMeta: ViewMetaProps = {
      viewId: containerId,
      name: containerView.name,
      layout: containerView.layout,
      icon: undefined,
      extra: containerView.extra,
      workspaceId: 'workspace-id',
      visibleViewIds: [],
    };

    render(
      <MemoryRouter initialEntries={['/app/workspace-id/container-id']}>
        <DatabaseView
          doc={createDatabaseDoc('db-1', [gridViewId, boardViewId])}
          workspaceId={'workspace-id'}
          readOnly={false}
          viewMeta={viewMeta}
          updatePage={jest.fn()}
          updatePageIcon={jest.fn()}
          updatePageName={jest.fn()}
          onRendered={jest.fn()}
        />
      </MemoryRouter>
    );

    const databaseProps = global.__databaseViewTestState?.capturedDatabaseProps as
      | { databasePageId?: string; activeViewId?: string; visibleViewIds?: string[] }
      | undefined;

    expect(databaseProps?.databasePageId).toBe(containerId);
    expect(databaseProps?.activeViewId).toBe(gridViewId);
    expect(databaseProps?.visibleViewIds).toEqual([gridViewId, boardViewId]);
  });

  it('uses parent container metadata when the active child is missing from a shallow outline', () => {
    const containerId = 'container-id';
    const gridViewId = 'grid-view-id';

    const containerView: View = {
      view_id: containerId,
      name: 'New Database',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false, is_database_container: true, database_id: 'db-1' },
      children: [],
      has_children: true,
      is_published: false,
      is_private: false,
    };

    global.__databaseViewTestState = { outline: [containerView] };

    const viewMeta: ViewMetaProps = {
      viewId: gridViewId,
      parentViewId: containerId,
      name: 'Grid',
      layout: ViewLayout.Grid,
      icon: undefined,
      extra: { is_space: false, database_id: 'db-1' },
      workspaceId: 'workspace-id',
      visibleViewIds: [],
    };

    render(
      <MemoryRouter initialEntries={['/app/workspace-id/grid-view-id']}>
        <DatabaseView
          doc={createDatabaseDoc('db-1', [gridViewId])}
          workspaceId={'workspace-id'}
          readOnly={false}
          viewMeta={viewMeta}
          updatePage={jest.fn()}
          updatePageIcon={jest.fn()}
          updatePageName={jest.fn()}
          onRendered={jest.fn()}
        />
      </MemoryRouter>
    );

    const databaseProps = global.__databaseViewTestState?.capturedDatabaseProps as
      | { visibleViewIds?: string[]; databaseName: string }
      | undefined;
    const metaProps = global.__databaseViewTestState?.capturedViewMetaProps as
      | { viewId?: string; name?: string }
      | undefined;

    expect(databaseProps).toBeDefined();
    expect(metaProps).toBeDefined();

    expect(databaseProps?.visibleViewIds).toBeUndefined();
    expect(databaseProps?.databaseName).toBe('New Database');
    expect(metaProps?.viewId).toBe(containerId);
    expect(metaProps?.name).toBe('New Database');
  });

  it('falls back to breadcrumb container when outline lookup fails', () => {
    const containerId = 'container-id';
    const gridViewId = 'grid-view-id';

    // Outline does NOT contain the container (simulating a stale or shallow
    // outline where the container hasn't been included yet — e.g. right after
    // a hard refresh while loadOutline is still in flight).
    const containerView: View = {
      view_id: containerId,
      name: 'New Database',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false, is_database_container: true, database_id: 'db-1' },
      children: [],
      has_children: true,
      is_published: false,
      is_private: false,
    };

    global.__databaseViewTestState = {
      outline: [],
      breadcrumbs: [
        containerView,
        {
          view_id: gridViewId,
          name: 'Grid',
          icon: null,
          layout: ViewLayout.Grid,
          extra: { is_space: false, database_id: 'db-1' },
          children: [],
          is_published: false,
          is_private: false,
          parent_view_id: containerId,
        },
      ],
    };

    // viewMeta lacks parentViewId and database_id (simulating a fallback view
    // fetched from the server with minimal metadata).
    const viewMeta: ViewMetaProps = {
      viewId: gridViewId,
      name: 'Grid',
      layout: ViewLayout.Grid,
      icon: undefined,
      extra: { is_space: false },
      workspaceId: 'workspace-id',
      visibleViewIds: [],
    };

    render(
      <MemoryRouter initialEntries={['/app/workspace-id/grid-view-id']}>
        <DatabaseView
          doc={createDatabaseDoc('db-1', [gridViewId])}
          workspaceId={'workspace-id'}
          readOnly={false}
          viewMeta={viewMeta}
          updatePage={jest.fn()}
          updatePageIcon={jest.fn()}
          updatePageName={jest.fn()}
          onRendered={jest.fn()}
        />
      </MemoryRouter>
    );

    const databaseProps = global.__databaseViewTestState?.capturedDatabaseProps as { databaseName: string } | undefined;
    const metaProps = global.__databaseViewTestState?.capturedViewMetaProps as
      | { viewId?: string; name?: string }
      | undefined;

    expect(databaseProps?.databaseName).toBe('New Database');
    expect(metaProps?.viewId).toBe(containerId);
    expect(metaProps?.name).toBe('New Database');
  });

  it('does not mark a modern database child as legacy while its parent hierarchy is unresolved', () => {
    const gridViewId = 'modern-grid-view-id';
    const getDatabaseContainerUpgradeStatus = jest.fn();

    global.__databaseViewTestState = { outline: [], getDatabaseContainerUpgradeStatus };

    render(
      <MemoryRouter initialEntries={[`/app/workspace-id/${gridViewId}`]}>
        <DatabaseView
          doc={createDatabaseDoc('db-1', [gridViewId])}
          workspaceId='workspace-id'
          readOnly={false}
          canWrite={true}
          viewMeta={{
            viewId: gridViewId,
            parentViewId: 'unresolved-container-id',
            name: 'Grid',
            layout: ViewLayout.Grid,
            extra: { is_space: false, database_id: 'db-1' },
            workspaceId: 'workspace-id',
          }}
          onRendered={jest.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('legacy-database-upgrade-banner')).toBeNull();
    expect(getDatabaseContainerUpgradeStatus).not.toHaveBeenCalled();
  });

  it('offers the legacy upgrade for a mounted database view whose canonical inline view is hidden', async () => {
    const canonicalInlineViewId = 'unprojected-inline-view-id';
    const mountedViewId = 'mounted-legacy-view-id';
    const mountedTabViewId = 'mounted-legacy-tab-id';
    const mountedTab: View = {
      ...createLegacyDatabaseView(mountedTabViewId),
      name: 'Board',
      layout: ViewLayout.Board,
      extra: { is_space: false, database_id: 'db-1' },
      parent_view_id: mountedViewId,
    };
    const mountedView: View = {
      ...createLegacyDatabaseView(mountedViewId),
      extra: { is_space: false, database_id: 'db-1' },
      parent_view_id: 'document-id',
      children: [mountedTab],
    };
    const documentView: View = {
      view_id: 'document-id',
      name: 'Getting started',
      icon: null,
      layout: ViewLayout.Document,
      extra: { is_space: false },
      children: [mountedView],
      has_children: true,
      is_published: false,
      is_private: false,
    };

    const getDatabaseContainerUpgradeStatus = jest.fn().mockResolvedValue({ eligible: true, already_upgraded: false });

    global.__databaseViewTestState = {
      outline: [documentView],
      getDatabaseContainerUpgradeStatus,
    };

    render(
      <MemoryRouter initialEntries={[`/app/workspace-id/${mountedViewId}`]}>
        <DatabaseView
          doc={createDatabaseDoc(
            'db-1',
            [canonicalInlineViewId, mountedViewId, mountedTabViewId],
            canonicalInlineViewId
          )}
          workspaceId='workspace-id'
          readOnly={false}
          canWrite={true}
          viewMeta={{
            viewId: mountedViewId,
            parentViewId: 'document-id',
            name: mountedView.name,
            layout: mountedView.layout,
            extra: mountedView.extra,
            workspaceId: 'workspace-id',
          }}
          onRendered={jest.fn()}
        />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('upgrade-database-container-button')).toBeTruthy();
    expect(getDatabaseContainerUpgradeStatus).toHaveBeenCalledWith('test-workspace', mountedViewId);
  });

  it('retries a transient eligibility response before showing the upgrade', async () => {
    const mountedViewId = 'mounted-legacy-view-id';
    const mountedTabViewId = 'mounted-legacy-tab-id';
    const mountedView: View = {
      ...createLegacyDatabaseView(mountedViewId),
      children: [
        {
          ...createLegacyDatabaseView(mountedTabViewId),
          layout: ViewLayout.Board,
          parent_view_id: mountedViewId,
        },
      ],
    };
    const getDatabaseContainerUpgradeStatus = jest
      .fn()
      .mockRejectedValueOnce({ code: ERROR_CODE.RETRY_LATER, retryAfterSecs: 0 })
      .mockResolvedValueOnce({ eligible: true, already_upgraded: false });

    global.__databaseViewTestState = {
      outline: [createParentView(mountedView)],
      getDatabaseContainerUpgradeStatus,
    };

    render(
      <MemoryRouter initialEntries={[`/app/workspace-id/${mountedViewId}`]}>
        <DatabaseView
          doc={createDatabaseDoc('db-1', [mountedViewId, mountedTabViewId], mountedViewId)}
          workspaceId='workspace-id'
          readOnly={false}
          canWrite={true}
          viewMeta={{
            viewId: mountedViewId,
            name: mountedView.name,
            layout: mountedView.layout,
            extra: mountedView.extra,
            workspaceId: 'workspace-id',
          }}
          onRendered={jest.fn()}
        />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('upgrade-database-container-button')).toBeTruthy();
    expect(getDatabaseContainerUpgradeStatus).toHaveBeenCalledTimes(2);
  });

  it('does not offer the upgrade when the server identifies a modern linked alias', async () => {
    const canonicalInlineViewId = 'modern-inline-view-id';
    const linkedAliasViewId = 'modern-linked-alias-id';
    const linkedAlias: View = {
      ...createLegacyDatabaseView(linkedAliasViewId),
      extra: { is_space: false, database_id: 'db-1' },
      parent_view_id: 'document-id',
    };
    const documentView: View = {
      view_id: 'document-id',
      name: 'Document',
      icon: null,
      layout: ViewLayout.Document,
      extra: { is_space: false },
      children: [linkedAlias],
      has_children: true,
      is_published: false,
      is_private: false,
    };
    const getDatabaseContainerUpgradeStatus = jest.fn().mockResolvedValue({ eligible: false, already_upgraded: false });

    global.__databaseViewTestState = {
      outline: [documentView],
      getDatabaseContainerUpgradeStatus,
    };

    render(
      <MemoryRouter initialEntries={[`/app/workspace-id/${linkedAliasViewId}`]}>
        <DatabaseView
          doc={createDatabaseDoc('db-1', [canonicalInlineViewId, linkedAliasViewId], canonicalInlineViewId)}
          workspaceId='workspace-id'
          readOnly={false}
          canWrite={true}
          viewMeta={{
            viewId: linkedAliasViewId,
            parentViewId: 'document-id',
            name: linkedAlias.name,
            layout: linkedAlias.layout,
            extra: linkedAlias.extra,
            workspaceId: 'workspace-id',
          }}
          onRendered={jest.fn()}
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getDatabaseContainerUpgradeStatus).toHaveBeenCalledWith('test-workspace', linkedAliasViewId);
    });
    expect(screen.queryByTestId('legacy-database-upgrade-banner')).toBeNull();
  });

  it('does not offer the legacy upgrade for a nested database tab', () => {
    const canonicalInlineViewId = 'unprojected-inline-view-id';
    const mountedViewId = 'mounted-legacy-view-id';
    const nestedTabId = 'nested-board-view-id';
    const nestedTab: View = {
      ...createLegacyDatabaseView(nestedTabId),
      name: 'Board',
      layout: ViewLayout.Board,
      extra: { is_space: false, database_id: 'db-1' },
      parent_view_id: mountedViewId,
    };
    const mountedView: View = {
      ...createLegacyDatabaseView(mountedViewId),
      extra: { is_space: false, database_id: 'db-1' },
      children: [nestedTab],
    };
    const getDatabaseContainerUpgradeStatus = jest.fn();

    global.__databaseViewTestState = {
      outline: [createParentView(mountedView)],
      getDatabaseContainerUpgradeStatus,
    };

    render(
      <MemoryRouter initialEntries={[`/app/workspace-id/${nestedTabId}`]}>
        <DatabaseView
          doc={createDatabaseDoc('db-1', [canonicalInlineViewId, mountedViewId, nestedTabId], canonicalInlineViewId)}
          workspaceId='workspace-id'
          readOnly={false}
          canWrite={true}
          viewMeta={{
            viewId: nestedTabId,
            parentViewId: mountedViewId,
            name: nestedTab.name,
            layout: nestedTab.layout,
            extra: nestedTab.extra,
            workspaceId: 'workspace-id',
          }}
          onRendered={jest.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('legacy-database-upgrade-banner')).toBeNull();
    expect(getDatabaseContainerUpgradeStatus).not.toHaveBeenCalled();
  });

  it.each([
    { caseName: 'read-only view', readOnly: true, canWrite: true, embedded: false },
    { caseName: 'view without write permission', readOnly: false, canWrite: false, embedded: false },
    { caseName: 'embedded database', readOnly: false, canWrite: true, embedded: true },
  ])('does not offer the legacy upgrade for a $caseName', ({ readOnly, canWrite, embedded }) => {
    const inlineViewId = 'legacy-inline-view-id';
    const legacyView = createLegacyDatabaseView(inlineViewId, embedded);
    const getDatabaseContainerUpgradeStatus = jest.fn();

    global.__databaseViewTestState = {
      outline: [createParentView(legacyView)],
      getDatabaseContainerUpgradeStatus,
    };

    render(
      <MemoryRouter initialEntries={[`/app/workspace-id/${inlineViewId}`]}>
        <DatabaseView
          doc={createDatabaseDoc('db-1', [inlineViewId])}
          workspaceId='workspace-id'
          readOnly={readOnly}
          canWrite={canWrite}
          viewMeta={{
            viewId: inlineViewId,
            name: legacyView.name,
            layout: legacyView.layout,
            extra: legacyView.extra,
            workspaceId: 'workspace-id',
          }}
          onRendered={jest.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('legacy-database-upgrade-banner')).toBeNull();
    expect(getDatabaseContainerUpgradeStatus).not.toHaveBeenCalled();
  });

  it('upgrades an open legacy mounted database and reconciles its preserved view route', async () => {
    const canonicalInlineViewId = 'unprojected-inline-view-id';
    const mountedViewId = 'legacy-mounted-view-id';
    const refreshOutline = jest.fn().mockResolvedValue(undefined);
    const ensureViewVisibleInOutline = jest.fn().mockResolvedValue(['general-space-id', 'new-container-id']);
    const upgradeDatabaseContainer = jest.fn().mockResolvedValue({
      database_id: 'db-1',
      database_view_id: mountedViewId,
      container_view_id: 'new-container-id',
      upgraded: true,
    });
    const navigateToView = jest.fn().mockResolvedValue(undefined);
    const legacyView: View = {
      view_id: mountedViewId,
      name: 'Legacy database',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
      parent_view_id: 'general-space-id',
    };
    const parentView: View = {
      view_id: 'general-space-id',
      name: 'General',
      icon: null,
      layout: ViewLayout.Document,
      extra: { is_space: true },
      children: [legacyView],
      has_children: true,
      is_published: false,
      is_private: false,
    };

    global.__databaseViewTestState = {
      outline: [parentView],
      refreshOutline,
      ensureViewVisibleInOutline,
      getDatabaseContainerUpgradeStatus: jest.fn().mockResolvedValue({ eligible: true, already_upgraded: false }),
      upgradeDatabaseContainer,
    };

    render(
      <MemoryRouter initialEntries={[`/app/workspace-id/${mountedViewId}`]}>
        <DatabaseView
          doc={createDatabaseDoc('db-1', [canonicalInlineViewId, mountedViewId], canonicalInlineViewId)}
          workspaceId='workspace-id'
          readOnly={false}
          canWrite={true}
          viewMeta={{
            viewId: mountedViewId,
            name: legacyView.name,
            layout: legacyView.layout,
            extra: legacyView.extra,
            workspaceId: 'workspace-id',
          }}
          navigateToView={navigateToView}
          onRendered={jest.fn()}
        />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByTestId('upgrade-database-container-button'));

    await waitFor(() => {
      expect(upgradeDatabaseContainer).toHaveBeenCalledWith('test-workspace', mountedViewId);
      expect(refreshOutline).toHaveBeenCalledTimes(1);
      expect(ensureViewVisibleInOutline).toHaveBeenCalledWith(mountedViewId);
    });
    expect(refreshOutline.mock.invocationCallOrder[0]).toBeLessThan(
      ensureViewVisibleInOutline.mock.invocationCallOrder[0]
    );
    expect(navigateToView).not.toHaveBeenCalled();
    expect(screen.queryByTestId('legacy-database-upgrade-banner')).toBeNull();
  });

  it('keeps the committed migration successful when outline reconciliation fails', async () => {
    const mountedViewId = 'legacy-mounted-view-id';
    const mountedTabViewId = 'legacy-mounted-tab-id';
    const legacyView: View = {
      ...createLegacyDatabaseView(mountedViewId),
      children: [
        {
          ...createLegacyDatabaseView(mountedTabViewId),
          layout: ViewLayout.Board,
          parent_view_id: mountedViewId,
        },
      ],
    };
    const refreshOutline = jest.fn().mockRejectedValue(new Error('outline refresh unavailable'));

    global.__databaseViewTestState = {
      outline: [createParentView(legacyView)],
      refreshOutline,
      ensureViewVisibleInOutline: jest.fn(),
      getDatabaseContainerUpgradeStatus: jest.fn().mockResolvedValue({ eligible: true, already_upgraded: false }),
      upgradeDatabaseContainer: jest.fn().mockResolvedValue({
        database_id: 'db-1',
        database_view_id: mountedViewId,
        container_view_id: 'new-container-id',
        upgraded: true,
      }),
    };

    render(
      <MemoryRouter initialEntries={[`/app/workspace-id/${mountedViewId}`]}>
        <DatabaseView
          doc={createDatabaseDoc('db-1', [mountedViewId, mountedTabViewId], mountedViewId)}
          workspaceId='workspace-id'
          readOnly={false}
          canWrite={true}
          viewMeta={{
            viewId: mountedViewId,
            name: legacyView.name,
            layout: legacyView.layout,
            extra: legacyView.extra,
            workspaceId: 'workspace-id',
          }}
          onRendered={jest.fn()}
        />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByTestId('upgrade-database-container-button'));

    await waitFor(() => expect(refreshOutline).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('web.databaseContainerUpgrade.success');
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByTestId('legacy-database-upgrade-banner')).toBeNull();
  });
});
