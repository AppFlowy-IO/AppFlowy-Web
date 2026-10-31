import { fireEvent, render, screen } from '@testing-library/react';

import { DashboardContext, DashboardContextValue } from '../DashboardContext';
import { DashboardEmptyState } from '../DashboardEmptyState';

import { createDashboardContextValue } from './dashboardTestHarness';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

function renderEmpty(overrides: Partial<DashboardContextValue>, onNewView = jest.fn()) {
  const context = createDashboardContextValue(overrides);

  render(
    <DashboardContext.Provider value={context}>
      <DashboardEmptyState onNewView={onNewView} />
    </DashboardContext.Provider>
  );
  return { context, onNewView, root: screen.getByTestId('dashboard-empty-state') };
}

describe('DashboardEmptyState: View mode (WP06 §1.9)', () => {
  it('invites a writer to edit, above the illustration, without a border or a New view button', () => {
    const { context, root } = renderEmpty({ isEditing: false });

    expect(root.getAttribute('data-editing')).toBe('false');
    expect(root.textContent).toContain('Add charts, tables, lists');
    expect(root.className).not.toMatch(/\bborder\b|border-dashed/);
    expect(screen.getByTestId('dashboard-empty-illustration').getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByTestId('dashboard-empty-new-view-button')).toBeNull();

    const edit = screen.getByTestId('dashboard-empty-edit-dashboard-button');

    expect(edit.textContent).toBe('Edit dashboard');
    expect(edit.querySelector('svg')).toBeNull();
    fireEvent.click(edit);
    expect(context.setEditing).toHaveBeenCalledWith(true);
  });

  it('offers no Edit dashboard button to a reader', () => {
    renderEmpty({ canEdit: false, canEnterEdit: false });

    expect(screen.getByTestId('dashboard-empty-state').textContent).toContain('Add charts, tables, lists');
    expect(screen.queryByTestId('dashboard-empty-edit-dashboard-button')).toBeNull();
  });

  it('offers no Edit dashboard button where Edit mode cannot be entered (phone width)', () => {
    renderEmpty({ canEdit: true, canEnterEdit: false, mobileContext: true });

    expect(screen.queryByTestId('dashboard-empty-edit-dashboard-button')).toBeNull();
  });

  it('fades the bottom of the illustration out and draws it in the tertiary icon color', () => {
    renderEmpty({});
    const illustration = screen.getByTestId('dashboard-empty-illustration');

    expect(illustration.getAttribute('class')).toContain('text-icon-tertiary');
    expect(illustration.getAttribute('class')).toContain('opacity-50');
    expect(illustration.getAttribute('style')).toContain('linear-gradient(to bottom, #000 60%, transparent)');
  });
});

describe('DashboardEmptyState: Edit mode', () => {
  it('shows one placeholder widget with five faint view icons and the New view pill', () => {
    const { root } = renderEmpty({ isEditing: true });

    expect(root.getAttribute('data-editing')).toBe('true');
    expect(root.style.height).toBe('360px');
    expect(screen.getByTestId('dashboard-empty-placeholder')).toBeTruthy();
    expect(
      screen.getAllByTestId('dashboard-empty-type-icon').map((icon) => icon.getAttribute('data-parity-id'))
    ).toEqual([
      'dash-empty-type-icon-list',
      'dash-empty-type-icon-bar',
      'dash-empty-type-icon-donut',
      'dash-empty-type-icon-table',
      'dash-empty-type-icon-line',
    ]);
    expect(screen.queryByTestId('dashboard-empty-edit-dashboard-button')).toBeNull();
    expect(screen.getByTestId('dashboard-empty-new-view-button').textContent).toBe('New view');
  });

  it('starts the add flow from the pill', () => {
    const { onNewView } = renderEmpty({ isEditing: true });

    fireEvent.click(screen.getByTestId('dashboard-empty-new-view-button'));
    expect(onNewView).toHaveBeenCalledTimes(1);
  });

  it('shows the View-mode invitation when write access is only being re-checked', () => {
    renderEmpty({ isEditing: true, canEdit: false, canEnterEdit: false });

    expect(screen.getByTestId('dashboard-empty-state').getAttribute('data-editing')).toBe('false');
    expect(screen.queryByTestId('dashboard-empty-new-view-button')).toBeNull();
  });
});
