import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DatabaseViewLayout, ViewLayout } from '@/application/types';
import { Dialog } from '@/components/ui/dialog';

import { WidgetPickerContent } from '../WidgetPickerContent';

let mockExperimentalDatabaseViewCreationEnabled = false;

jest.mock('@/application/constants', () => ({
  ...jest.requireActual('@/application/constants'),
  get EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED() {
    return mockExperimentalDatabaseViewCreationEnabled;
  },
}));

jest.mock('@/application/database-yjs', () => ({
  useDatabase: () => undefined,
  useDatabaseContext: () => ({
    activeViewId: 'host-dashboard',
    workspaceId: 'workspace',
    createDatabaseView: jest.fn(),
  }),
}));

jest.mock('../DashboardContext', () => ({
  useDashboardContext: () => ({ hostDatabaseId: 'host-db', dashboardViewId: 'host-dashboard' }),
  useDashboardLayout: () => ({ hostViewIds: ['host-timeline'], rows: [] }),
  useDashboardSources: () => ({ sourceNames: { 'host-db': 'Projects' } }),
}));

jest.mock('../hooks/useHostViews', () => ({
  useHostViews: () => [
    { viewId: 'host-timeline', name: 'Project timeline', layout: ViewLayout.Timeline, embedded: false },
  ],
}));

jest.mock('../hooks/useWorkspaceDatabases', () => ({
  useWorkspaceDatabases: () => ({ databases: [], loading: false, error: null }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/components/_shared/view-icon', () => ({ ViewIcon: () => null }));
jest.mock('@/components/_shared/view-icon/PageIcon', () => ({ __esModule: true, default: () => null }));

function renderPicker() {
  const onPick = jest.fn();
  const createView = jest.fn().mockResolvedValue('created-view');

  render(
    <Dialog open>
      <WidgetPickerContent
        canCreateInOtherDatabases
        createView={createView}
        onPick={onPick}
        request={{ mode: 'add', placement: { type: 'new_row', rowIndex: 0 } }}
      />
    </Dialog>
  );

  return { onPick, createView };
}

function openNewViewTab() {
  fireEvent.keyDown(screen.getByTestId('dashboard-widget-picker-new-view'), { key: 'Enter' });
}

describe('WidgetPickerContent creation gate', () => {
  beforeEach(() => {
    mockExperimentalDatabaseViewCreationEnabled = false;
  });

  it('keeps existing Timeline views selectable while experimental creation is disabled', () => {
    const { onPick, createView } = renderPicker();

    fireEvent.click(screen.getByRole('button', { name: 'Project timeline Timeline' }));

    expect(onPick).toHaveBeenCalledWith('host-timeline', 'host-db');
    expect(createView).not.toHaveBeenCalled();
  });

  it('hides Timeline creation while allowing supported layouts when the gate is disabled', async () => {
    const { createView } = renderPicker();

    openNewViewTab();

    expect(screen.queryByRole('button', { name: 'Timeline', exact: true })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Grid', exact: true }));

    await waitFor(() => expect(createView).toHaveBeenCalledWith({
      databaseId: 'host-db',
      primaryViewId: 'host-dashboard',
      isHost: true,
      layout: DatabaseViewLayout.Grid,
      name: 'Grid',
    }));
  });

  it('creates Timeline views when experimental creation is enabled', async () => {
    mockExperimentalDatabaseViewCreationEnabled = true;
    const { createView } = renderPicker();

    openNewViewTab();
    fireEvent.click(screen.getByRole('button', { name: 'Timeline', exact: true }));

    await waitFor(() => expect(createView).toHaveBeenCalledWith({
      databaseId: 'host-db',
      primaryViewId: 'host-dashboard',
      isHost: true,
      layout: DatabaseViewLayout.Timeline,
      name: 'Timeline',
    }));
  });

  it('rejects a Timeline creation callback when the gate is disabled after rendering', () => {
    mockExperimentalDatabaseViewCreationEnabled = true;
    const { createView } = renderPicker();

    openNewViewTab();
    const timeline = screen.getByRole('button', { name: 'Timeline', exact: true });

    mockExperimentalDatabaseViewCreationEnabled = false;
    fireEvent.click(timeline);

    expect(createView).not.toHaveBeenCalled();
  });
});
