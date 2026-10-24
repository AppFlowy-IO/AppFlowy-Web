import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import { ViewLayout, type ViewMetaProps, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import DatabaseView from '@/components/app/DatabaseView';
import { loadDashboard } from '@/components/database/dashboard/load';

jest.mock('@/components/database/dashboard/load', () => ({
  loadDashboard: jest.fn(() => Promise.resolve({})),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOutline: () => undefined,
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
jest.mock('@/components/database', () => ({ Database: () => null }));
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
});
