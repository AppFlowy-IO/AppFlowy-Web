import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { YDoc } from '@/application/types';

import { DashboardActions } from '../DashboardActions';
import {
  DashboardContext,
  DashboardContextValue,
  DashboardFiltersContext,
  DashboardFiltersContextValue,
} from '../DashboardContext';

const mockOpenDatabaseAsPage = jest.fn();
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
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid='dashboard-settings-menu-trigger'>{children}</div>
  ),
}));

jest.mock('@/components/database/hooks/useOpenDatabaseAsPage', () => ({
  useOpenDatabaseAsPage: (options: { viewId?: string; fallbackViewId?: string }) => mockUseOpenDatabaseAsPage(options),
}));

function createContext(overrides: Partial<DashboardContextValue> = {}): DashboardContextValue {
  return {
    dashboardViewId: 'dashboard-view',
    hostDatabaseId: 'db',
    canEdit: true,
    isEditing: false,
    setEditing: jest.fn(),
    mobileContext: false,
    canEnterEdit: true,
    editPreference: 'off',
    pinEditing: jest.fn(),
    updateSetting: jest.fn(),
    updateRows: jest.fn(),
    ...overrides,
  };
}

const FILTERS: DashboardFiltersContextValue = {
  globalFilters: [],
  effectiveGlobalFilters: [],
  localGlobalFilters: null,
  setLocalGlobalFilters: jest.fn(),
  getViewOverlay: jest.fn(),
  setViewOverlayWritable: jest.fn(),
  resetViewOverlays: jest.fn(),
  commitViewOverlays: jest.fn(),
};

function database(overrides: Partial<DatabaseContextState> = {}): DatabaseContextState {
  return {
    readOnly: false,
    databaseDoc: {} as YDoc,
    databasePageId: 'host-page',
    activeViewId: 'dashboard-view',
    rowMap: {},
    workspaceId: 'workspace-id',
    ...overrides,
  };
}

function renderActions(context = createContext(), databaseContext = database()) {
  return render(
    <DatabaseContext.Provider value={databaseContext}>
      <DashboardContext.Provider value={context}>
        <DashboardFiltersContext.Provider value={FILTERS}>
          <DashboardActions />
        </DashboardFiltersContext.Provider>
      </DashboardContext.Provider>
    </DatabaseContext.Provider>
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
    renderActions();

    expect(toolbarButtons()).toEqual([
      'dashboard-global-filter-button',
      'database-actions-settings',
      'dashboard-edit-button',
    ]);
    expect(screen.getByTestId('dashboard-actions').getAttribute('data-parity-id')).toBe('dash-toolbar');
    expect(screen.getByTestId('dashboard-actions').className).toContain('gap-1');

    const edit = screen.getByTestId('dashboard-edit-button');

    expect(edit.querySelector('svg')).toBeNull();
    expect(edit.textContent).toBe('Edit');
    // 1px outline + 9px padding: the text sits 10px in, as on Done.
    for (const name of ['h-7', '!rounded-200', 'px-[9px]', 'py-1', 'font-medium', 'border-border-primary']) {
      expect(edit.className).toContain(name);
    }

    expect(edit.className).not.toContain('px-2.5');
  });

  it('shows Done, filled with the accent, while editing', () => {
    const setEditing = jest.fn();

    renderActions(createContext({ isEditing: true, editPreference: 'on', setEditing }));
    const done = screen.getByTestId('dashboard-done-button');

    expect(toolbarButtons()).toEqual([
      'dashboard-global-filter-button',
      'database-actions-settings',
      'dashboard-done-button',
    ]);
    expect(done.className).toContain('bg-fill-theme-thick');
    expect(done.className).toContain('h-7');
    expect(done.className).toContain('px-2.5');
    fireEvent.click(done);
    expect(setEditing).toHaveBeenCalledWith(false);
  });

  it('draws 28px icon buttons with 16px glyphs, and the filter button has no badge', () => {
    renderActions();

    for (const testId of ['dashboard-global-filter-button', 'database-actions-settings']) {
      const button = screen.getByTestId(testId);

      for (const name of ['h-7', 'w-7', '!rounded-200', 'p-1.5', 'text-dash-tool-icon', '[&_svg]:h-4']) {
        expect(button.className).toContain(name);
      }
    }

    expect(screen.getByTestId('database-actions-settings').getAttribute('data-parity-id')).toBe('dash-toolbar-settings');
    expect(
      screen.getByTestId('database-actions-settings').querySelector('[data-parity-id="dash-toolbar-settings__icon"]')
    ).not.toBeNull();
    expect(screen.queryByTestId('dashboard-global-filter-button-badge')).toBeNull();
  });

  it('adds "Open as full page" after Filter when the dashboard is embedded, opening the dashboard view itself', () => {
    renderActions(createContext(), database({ isDocumentBlock: true }));

    expect(toolbarButtons()).toEqual([
      'dashboard-global-filter-button',
      'dashboard-toolbar-open-as-page',
      'database-actions-settings',
      'dashboard-edit-button',
    ]);
    expect(mockUseOpenDatabaseAsPage).toHaveBeenCalledWith({ viewId: 'dashboard-view', fallbackViewId: 'host-page' });
    const expand = screen.getByTestId('dashboard-toolbar-open-as-page');

    expect(expand.getAttribute('aria-label')).toBe('Open as full page');
    expect(expand.className).toContain('h-7');
    fireEvent.click(expand);
    expect(mockOpenDatabaseAsPage).toHaveBeenCalledTimes(1);
  });

  it('gives readers only the filter button, plus "Open as full page" when embedded', () => {
    const reader = createContext({ canEdit: false, canEnterEdit: false });
    const { unmount } = renderActions(reader, database({ readOnly: true }));

    expect(toolbarButtons()).toEqual(['dashboard-global-filter-button']);
    unmount();

    renderActions(reader, database({ readOnly: true, isDocumentBlock: true }));
    expect(toolbarButtons()).toEqual(['dashboard-global-filter-button', 'dashboard-toolbar-open-as-page']);
  });

  it('keeps Settings and Open as full page without a dashboard provider (they only need the database)', () => {
    render(
      <DatabaseContext.Provider value={database({ isDocumentBlock: true })}>
        <DashboardActions />
      </DatabaseContext.Provider>
    );

    expect(toolbarButtons()).toEqual(['dashboard-toolbar-open-as-page', 'database-actions-settings']);
  });

  it('offers no Settings in a mobile context (view-only)', () => {
    renderActions(createContext({ mobileContext: true, canEnterEdit: false }));

    expect(toolbarButtons()).toEqual(['dashboard-global-filter-button']);
    expect(screen.queryByTestId('database-actions-settings')).toBeNull();
  });
});
