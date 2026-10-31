import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { DashboardPrivateSummary } from '@/components/database/dashboard/DashboardContext';

import { DashboardSaveControls } from '../DashboardSaveControls';

let mockSummary: DashboardPrivateSummary;
const mockSave = jest.fn();
const mockReset = jest.fn();

jest.mock('@/components/database/dashboard/DashboardContext', () => ({
  useDashboardPrivateSummary: () => mockSummary,
  useDashboardFilters: () => ({ saveForEveryone: mockSave, resetPrivateChanges: mockReset }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const CLEAN: DashboardPrivateSummary = {
  hasChanges: false,
  canSave: false,
  dirtyGlobalCount: 0,
  dirtyWidgetCount: 0,
  savableWidgetCount: 0,
};

beforeAll(() => {
  // Radix menus open on a primary-button pointerdown, which jsdom cannot build.
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  HTMLElement.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  jest.clearAllMocks();
});

function openMenu() {
  fireEvent.pointerDown(screen.getByTestId('dashboard-global-filter-save-menu-trigger'), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  });
}

describe('DashboardSaveControls', () => {
  it('writers get Reset and the split with a menu', async () => {
    mockSummary = { ...CLEAN, hasChanges: true, canSave: true, dirtyGlobalCount: 1 };
    render(<DashboardSaveControls />);

    const controls = screen.getByTestId('dashboard-private-controls');
    const save = screen.getByTestId('dashboard-global-filter-save-for-everyone');

    expect(controls.textContent).toContain('Reset');
    expect(save.textContent).toBe('Save for everyone');
    // The peach split button the parity probe measures.
    const split = controls.querySelector('[data-parity-id="dash-global-filter-save"]') as HTMLElement;

    expect(split.className).toContain('bg-dash-save-bg');
    expect(split.className).toContain('text-dash-save-fg');
    expect(screen.getByTestId('dashboard-global-filter-save-menu-trigger').getAttribute('aria-label')).toBe(
      'More save options'
    );
    fireEvent.click(save);
    expect(mockSave).toHaveBeenCalledTimes(1);

    openMenu();
    const menu = await waitFor(() => screen.getByTestId('dashboard-global-filter-save-menu'));

    expect(menu.className).toContain('w-[220px]');
    fireEvent.click(screen.getByTestId('dashboard-save-menu-save'));
    expect(mockSave).toHaveBeenCalledTimes(2);
  });

  it('Reset all changes resets everything', async () => {
    mockSummary = { ...CLEAN, hasChanges: true, canSave: true, dirtyWidgetCount: 1, savableWidgetCount: 1 };
    render(<DashboardSaveControls />);

    openMenu();
    fireEvent.click(await waitFor(() => screen.getByTestId('dashboard-save-menu-reset-all')));
    expect(mockReset).toHaveBeenCalledWith();
    fireEvent.click(screen.getByTestId('dashboard-global-filter-reset'));
    expect(mockReset).toHaveBeenCalledTimes(2);
  });

  it('readers get Reset only', () => {
    mockSummary = { ...CLEAN, hasChanges: true, canSave: false, dirtyGlobalCount: 1 };
    render(<DashboardSaveControls />);

    expect(screen.getByTestId('dashboard-global-filter-reset')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-global-filter-save-for-everyone')).toBeNull();
    expect(screen.queryByTestId('dashboard-global-filter-save-menu-trigger')).toBeNull();
  });

  it('hidden in Edit mode', () => {
    // The summary has no changes in Edit mode (the private state is set aside).
    mockSummary = CLEAN;
    const { container } = render(<DashboardSaveControls />);

    expect(container.innerHTML).toBe('');
  });
});
