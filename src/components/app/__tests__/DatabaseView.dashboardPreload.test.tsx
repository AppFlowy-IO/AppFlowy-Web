import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import { ViewLayout, type View, type ViewMetaProps, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useAppOutline } from '@/components/app/app.hooks';
import DatabaseView from '@/components/app/DatabaseView';
import { Database } from '@/components/database';
import { loadDashboard } from '@/components/database/dashboard/load';

jest.mock('@/components/database/dashboard/load', () => ({
  loadDashboard: jest.fn(() => Promise.resolve({})),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOutline: jest.fn(),
  useBreadcrumb: () => undefined,
  useCurrentWorkspaceIdOptional: () => 'workspace',
  useEnsureViewVisibleInOutline: () => undefined,
  useEventEmitter: () => ({ emit: jest.fn() }),
  useRefreshOutline: () => undefined,
}));

jest.mock('@/application/services/domains', () => ({
  PageService: {
    moveTo: jest.fn(),
    getDatabaseContainerUpgradeStatus: () => Promise.resolve({ eligible: false, already_upgraded: false }),
    upgradeDatabaseContainer: jest.fn(),
  },
  ViewService: {
    invalidateDatabaseCatalog: jest.fn(),
    refreshWorkspaceDatabaseCatalog: () => Promise.resolve([]),
  },
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/log', () => ({ Log: { warn: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/database', () => ({ Database: jest.fn(() => null) }));
jest.mock('src/components/view-meta/ViewMetaPreview', () => () => null);

/** A database document whose views have not synced yet: the page shows its skeleton. */
function createLoadingDatabaseDoc(): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map();

  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.views, new Y.Map());
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  return doc;
}

function renderLoadingPage(layout: ViewLayout) {
  const viewMeta: ViewMetaProps = {
    viewId: 'view-id',
    name: 'Page',
    layout,
    workspaceId: 'workspace',
    visibleViewIds: [],
  };

  return render(
    <MemoryRouter initialEntries={['/app/workspace/view-id']}>
      <DatabaseView
        doc={createLoadingDatabaseDoc()}
        readOnly
        updatePage={jest.fn()}
        updatePageIcon={jest.fn()}
        updatePageName={jest.fn()}
        viewMeta={viewMeta}
        workspaceId='workspace'
      />
    </MemoryRouter>
  );
}

describe('DatabaseView dashboard preload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useAppOutline).mockReturnValue(undefined);
  });

  it('starts the dashboard chunk while a dashboard page still loads its document', () => {
    renderLoadingPage(ViewLayout.Dashboard);

    expect(screen.getByTestId('grid-skeleton')).toBeTruthy();
    expect(loadDashboard).toHaveBeenCalledTimes(1);
  });

  it('loads no dashboard code for a page of another layout', () => {
    renderLoadingPage(ViewLayout.Grid);

    expect(screen.getByTestId('grid-skeleton')).toBeTruthy();
    expect(loadDashboard).not.toHaveBeenCalled();
  });

  it('opens a document-owned dashboard on its own route instead of selecting the source Grid', () => {
    const view = (viewId: string, layout: ViewLayout, parent?: string): View => ({
      view_id: viewId,
      name: viewId,
      layout,
      parent_view_id: parent,
      icon: null,
      children: [],
      extra: { is_space: false, database_id: 'database', is_database_container: false },
      is_published: false,
      is_private: false,
    });
    const grid = view('source-grid', ViewLayout.Grid, 'source-container');
    const container = view('source-container', ViewLayout.Grid, 'space');

    container.extra = { ...container.extra, is_database_container: true };
    container.children = [grid];
    const linked = view('linked-dashboard', ViewLayout.Dashboard, 'document');
    const document = view('document', ViewLayout.Document, 'space');

    document.children = [linked];
    jest.mocked(useAppOutline).mockReturnValue([container, document]);
    const doc = createLoadingDatabaseDoc();
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;
    const views = database.get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;

    for (const folderView of [grid, linked]) {
      views.set(folderView.view_id, new Y.Map([
        [YjsDatabaseKey.id, folderView.view_id],
        [YjsDatabaseKey.name, folderView.name],
      ]));
    }

    render(
      <MemoryRouter initialEntries={['/app/workspace/linked-dashboard']}>
        <DatabaseView
          doc={doc}
          readOnly
          updatePage={jest.fn()}
          updatePageIcon={jest.fn()}
          updatePageName={jest.fn()}
          viewMeta={{
            viewId: linked.view_id,
            name: linked.name,
            parentViewId: 'document',
            layout: linked.layout,
            extra: linked.extra,
            workspaceId: 'workspace',
            visibleViewIds: [],
          }}
          workspaceId='workspace'
        />
      </MemoryRouter>
    );

    expect(jest.mocked(Database).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      activeViewId: 'linked-dashboard',
      databasePageId: 'linked-dashboard',
      databaseName: 'linked-dashboard',
      visibleViewIds: ['linked-dashboard'],
    }));
  });
});
