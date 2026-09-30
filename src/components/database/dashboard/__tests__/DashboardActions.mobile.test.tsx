import { fireEvent, render, screen, within } from '@testing-library/react';

import { DashboardActions } from '../DashboardActions';
import {
  DashboardContext,
  DashboardContextValue,
  DashboardFiltersContext,
  DashboardFiltersContextValue,
} from '../DashboardContext';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
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

function renderActions(context: DashboardContextValue) {
  return render(
    <DashboardContext.Provider value={context}>
      <DashboardFiltersContext.Provider value={FILTERS}>
        <DashboardActions />
      </DashboardFiltersContext.Provider>
    </DashboardContext.Provider>
  );
}

function toolbarTestIds() {
  return Array.from(screen.getByTestId('dashboard-actions').querySelectorAll('[data-testid]')).map((element) =>
    element.getAttribute('data-testid')
  );
}

describe('DashboardActions in a mobile context', () => {
  it.each([
    ['a writer in View mode', { editPreference: 'off' as const }],
    ['a writer whose Edit preference is on', { editPreference: 'on' as const }],
    ['a reader', { canEdit: false, editPreference: 'off' as const }],
  ])('shows only the global filter button for %s', (_name, overrides) => {
    renderActions(createContext({ mobileContext: true, canEnterEdit: false, isEditing: false, ...overrides }));
    const toolbar = screen.getByTestId('dashboard-actions');

    expect(toolbar.getAttribute('data-mobile')).toBe('true');
    expect(toolbarTestIds()).toEqual(['dashboard-global-filter-button']);
    expect(within(toolbar).queryByTestId('dashboard-edit-button')).toBeNull();
    expect(within(toolbar).queryByTestId('dashboard-done-button')).toBeNull();
  });
});

describe('DashboardActions outside a mobile context', () => {
  it('offers Edit to a writer who can enter Edit mode, and Done while editing', () => {
    const setEditing = jest.fn();
    const { rerender } = renderActions(createContext({ setEditing }));

    expect(screen.getByTestId('dashboard-actions').hasAttribute('data-mobile')).toBe(false);
    fireEvent.click(screen.getByTestId('dashboard-edit-button'));
    expect(setEditing).toHaveBeenLastCalledWith(true);

    rerender(
      <DashboardContext.Provider value={createContext({ setEditing, isEditing: true, editPreference: 'on' })}>
        <DashboardFiltersContext.Provider value={FILTERS}>
          <DashboardActions />
        </DashboardFiltersContext.Provider>
      </DashboardContext.Provider>
    );
    fireEvent.click(screen.getByTestId('dashboard-done-button'));
    expect(setEditing).toHaveBeenLastCalledWith(false);
  });

  it('offers no Edit button while Edit mode cannot be entered (write access not confirmed)', () => {
    renderActions(createContext({ canEdit: false, canEnterEdit: false }));

    expect(toolbarTestIds()).toEqual(['dashboard-global-filter-button']);
  });

  it('renders nothing outside a dashboard', () => {
    const { container } = render(<DashboardActions />);

    expect(container.innerHTML).toBe('');
  });
});
