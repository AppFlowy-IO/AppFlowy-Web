import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { YDoc } from '@/application/types';

import { DashboardActions, DashboardActionsProps } from '../DashboardActions';
import { DashboardContext, DashboardContextValue, DashboardFiltersContext } from '../DashboardContext';

import { createDashboardContextValue, createDashboardFiltersValue } from './dashboardTestHarness';

const mockOpenDatabaseAsPage = jest.fn();
const mockSettingsRender = jest.fn();
const mockUseOpenDatabaseAsPage = jest.fn((_options: { viewId?: string; fallbackViewId?: string }) => ({
  canOpen: true,
  isOpening: false,
  openDatabaseAsPage: mockOpenDatabaseAsPage,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/components/database/components/settings/DashboardSettings', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => {
    mockSettingsRender();
    return <div data-testid='dashboard-settings-menu-trigger'>{children}</div>;
  },
}));

jest.mock('@/components/database/hooks/useOpenDatabaseAsPage', () => ({
  useOpenDatabaseAsPage: (options: { viewId?: string; fallbackViewId?: string }) => mockUseOpenDatabaseAsPage(options),
}));

const FILTERS = createDashboardFiltersValue();

/** The host database as the database toolbar hands it over. */
function database(overrides: DashboardActionsProps = {}): DashboardActionsProps {
  return {
    readOnly: false,
    databasePageId: 'host-page',
    activeViewId: 'dashboard-view',
    isDocumentBlock: false,
    ...overrides,
  };
}

function renderActions(context: DashboardContextValue = createDashboardContextValue(), props = database()) {
  return render(
    <DashboardContext.Provider value={context}>
      <DashboardFiltersContext.Provider value={FILTERS}>
        <DashboardActions {...props} />
      </DashboardFiltersContext.Provider>
    </DashboardContext.Provider>
  );
}

/** The toolbar buttons, left to right. */
function toolbarButtons() {
  return Array.from(screen.getByTestId('dashboard-actions').querySelectorAll('button')).map((button) =>
    button.getAttribute('data-testid')
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DashboardActions', () => {
  it('orders Filter, Settings and a text-only Edit button', () => {
    const setEditing = jest.fn();

    renderActions(createDashboardContextValue({ setEditing }));

    expect(toolbarButtons()).toEqual([
      'dashboard-global-filter-button',
      'database-actions-settings',
      'dashboard-edit-button',
    ]);
    expect(screen.getByTestId('dashboard-actions').getAttribute('data-parity-id')).toBe('dash-toolbar');
    expect(screen.getByTestId('dashboard-actions').hasAttribute('data-mobile')).toBe(false);

    const edit = screen.getByTestId('dashboard-edit-button');

    expect(edit.querySelector('svg')).toBeNull();
    expect(edit.textContent).toBe('Edit');
    // The parity probe measures the outlined button and its label (text 10px in, as on Done).
    expect(edit.getAttribute('data-parity-id')).toBe('dash-toolbar-edit-button');
    expect(edit.querySelector('[data-parity-id="dash-toolbar-edit-button__label"]')?.textContent).toBe('Edit');
    expect(edit.getAttribute('type')).toBe('button');
    expect(edit.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByTestId('dashboard-done-button')).toBeNull();
    fireEvent.click(edit);
    expect(setEditing).toHaveBeenCalledTimes(1);
    expect(setEditing).toHaveBeenCalledWith(true);
  });

  it('shows Done, filled with the accent, while editing', () => {
    const setEditing = jest.fn();

    renderActions(createDashboardContextValue({ isEditing: true, setEditing }));
    const done = screen.getByTestId('dashboard-done-button');

    expect(toolbarButtons()).toEqual([
      'dashboard-global-filter-button',
      'database-actions-settings',
      'dashboard-done-button',
    ]);
    // The parity probe measures the filled button and its label.
    expect(done.getAttribute('data-parity-id')).toBe('dash-toolbar-done-button');
    expect(done.querySelector('[data-parity-id="dash-toolbar-done-button__label"]')?.textContent).toBe('Done');
    expect(screen.queryByTestId('dashboard-edit-button')).toBeNull();
    fireEvent.click(done);
    expect(setEditing).toHaveBeenCalledWith(false);
  });

  it('draws 28px icon buttons with 16px glyphs, and the filter button has no badge', () => {
    renderActions();

    for (const [testId, parityId, label] of [
      ['dashboard-global-filter-button', 'dash-toolbar-filter', 'Filter'],
      ['database-actions-settings', 'dash-toolbar-settings', 'Settings'],
    ]) {
      const button = screen.getByTestId(testId);
      const glyphs = button.querySelectorAll('svg');

      // The parity probe measures the 28px button and its 16px glyph.
      expect(button.getAttribute('data-parity-id')).toBe(parityId);
      expect(button.getAttribute('aria-label')).toBe(label);
      expect(button.getAttribute('type')).toBe('button');
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(glyphs).toHaveLength(1);
      expect(glyphs[0].getAttribute('aria-hidden')).toBe('true');
    }

    expect(screen.getByTestId('database-actions-settings').getAttribute('data-parity-id')).toBe('dash-toolbar-settings');
    expect(
      screen.getByTestId('database-actions-settings').querySelector('[data-parity-id="dash-toolbar-settings__icon"]')
    ).not.toBeNull();
    expect(screen.queryByTestId('dashboard-global-filter-button-badge')).toBeNull();
  });

  it('adds "Open as full page" after Filter when the dashboard is embedded, opening the dashboard view itself', () => {
    renderActions(createDashboardContextValue(), database({ isDocumentBlock: true }));

    expect(toolbarButtons()).toEqual([
      'dashboard-global-filter-button',
      'dashboard-toolbar-open-as-page',
      'database-actions-settings',
      'dashboard-edit-button',
    ]);
    expect(mockUseOpenDatabaseAsPage).toHaveBeenCalledWith({ viewId: 'dashboard-view', fallbackViewId: 'host-page' });
    const expand = screen.getByTestId('dashboard-toolbar-open-as-page');

    expect(expand.getAttribute('aria-label')).toBe('Open as full page');
    expect(expand.getAttribute('data-parity-id')).toBe('dash-toolbar-open-as-page');
    fireEvent.click(expand);
    expect(mockOpenDatabaseAsPage).toHaveBeenCalledTimes(1);
  });

  it('gives readers only the filter button, plus "Open as full page" when embedded', () => {
    const reader = createDashboardContextValue({ canEdit: false, canEnterEdit: false });
    const { unmount } = renderActions(reader, database({ readOnly: true }));

    expect(toolbarButtons()).toEqual(['dashboard-global-filter-button']);
    unmount();

    renderActions(reader, database({ readOnly: true, isDocumentBlock: true }));
    expect(toolbarButtons()).toEqual(['dashboard-global-filter-button', 'dashboard-toolbar-open-as-page']);
  });

  it('keeps Settings and Open as full page without a dashboard provider (they only need the database)', () => {
    render(<DashboardActions {...database({ isDocumentBlock: true })} />);

    expect(toolbarButtons()).toEqual(['dashboard-toolbar-open-as-page', 'database-actions-settings']);
  });

  it('does not re-render when only the host database context changes: it takes the database as primitives', () => {
    const context = createDashboardContextValue();
    const props = database();
    const host = (rowMap: DatabaseContextState['rowMap']): DatabaseContextState => ({
      readOnly: false,
      databaseDoc: {} as YDoc,
      databasePageId: 'host-page',
      activeViewId: 'dashboard-view',
      rowMap,
      workspaceId: 'workspace-id',
    });
    const tree = (value: DatabaseContextState) => (
      <DatabaseContext.Provider value={value}>
        <DashboardContext.Provider value={context}>
          <DashboardFiltersContext.Provider value={FILTERS}>
            <DashboardActions {...props} />
          </DashboardFiltersContext.Provider>
        </DashboardContext.Provider>
      </DatabaseContext.Provider>
    );
    const { rerender } = render(tree(host({})));
    const renders = mockSettingsRender.mock.calls.length;

    expect(renders).toBeGreaterThan(0);
    // A row of the host database loads: its context value is rebuilt.
    rerender(tree(host({ 'row-1': {} as YDoc })));
    expect(mockSettingsRender).toHaveBeenCalledTimes(renders);
    expect(toolbarButtons()).toEqual([
      'dashboard-global-filter-button',
      'database-actions-settings',
      'dashboard-edit-button',
    ]);
  });

  it('offers no Settings in a mobile context (view-only)', () => {
    renderActions(createDashboardContextValue({ mobileContext: true, canEnterEdit: false }));

    expect(toolbarButtons()).toEqual(['dashboard-global-filter-button']);
    expect(screen.queryByTestId('database-actions-settings')).toBeNull();
  });
});
