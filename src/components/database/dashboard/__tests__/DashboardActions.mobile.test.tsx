import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode } from 'react';

import { DashboardActions } from '../DashboardActions';
import {
  DashboardContext,
  DashboardContextValue,
  DashboardFiltersContext,
  DashboardLayoutContext,
  DashboardLayoutContextValue,
  DashboardSourcesContext,
  DashboardSourcesContextValue,
} from '../DashboardContext';

import { createDashboardContextValue as createContext, createDashboardFiltersValue } from './dashboardTestHarness';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const FILTERS = createDashboardFiltersValue();
// No widget is mounted: the filter button trusts every mapping it counts.
const LAYOUT: DashboardLayoutContextValue = { rows: [], hostViewIds: [], showWidgetTitles: true, showIconsInHeading: false };
const SOURCES: DashboardSourcesContextValue = {
  sourceDocs: {},
  registerSourceDoc: jest.fn(),
  sourceNames: {},
  registerSourceName: jest.fn(),
};

/** The dashboard contexts the toolbar and its filter button read. */
function DashboardProviders({ context, children }: { context: DashboardContextValue; children: ReactNode }) {
  return (
    <DashboardContext.Provider value={context}>
      <DashboardLayoutContext.Provider value={LAYOUT}>
        <DashboardSourcesContext.Provider value={SOURCES}>
          <DashboardFiltersContext.Provider value={FILTERS}>{children}</DashboardFiltersContext.Provider>
        </DashboardSourcesContext.Provider>
      </DashboardLayoutContext.Provider>
    </DashboardContext.Provider>
  );
}

function renderActions(context: DashboardContextValue) {
  return render(
    <DashboardProviders context={context}>
      <DashboardActions />
    </DashboardProviders>
  );
}

function toolbarTestIds() {
  return Array.from(screen.getByTestId('dashboard-actions').querySelectorAll('[data-testid]')).map((element) =>
    element.getAttribute('data-testid')
  );
}

describe('DashboardActions in a mobile context', () => {
  it.each([
    ['a writer in View mode', {}],
    ['a writer whose Edit preference is on', { isEditing: true }],
    ['a reader', { canEdit: false }],
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
      <DashboardProviders context={createContext({ setEditing, isEditing: true })}>
        <DashboardActions />
      </DashboardProviders>
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
