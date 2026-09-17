import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DatabaseViewLayout } from '@/application/types';
import DashboardSettings from '@/components/database/components/settings/DashboardSettings';
import { Button } from '@/components/ui/button';

const mockUpdateSetting = jest.fn();
let mockShowWidgetTitles = true;
let mockReadOnly = false;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/application/database-yjs', () => ({
  useDashboardLayoutSetting: () => ({
    rows: [],
    globalFilters: [],
    showWidgetTitles: mockShowWidgetTitles,
  }),
  useReadOnly: () => mockReadOnly,
  useUpdateDashboardSetting: () => mockUpdateSetting,
}));

jest.mock('@/components/database/components/settings/Layout', () => ({
  __esModule: true,
  default: ({ currentLayout }: { currentLayout: DatabaseViewLayout }) => (
    <div data-testid='layout-switcher' data-layout={currentLayout} />
  ),
}));

jest.mock('@/assets/icons/show.svg', () => ({
  ReactComponent: () => null,
}));

async function openMenu() {
  const trigger = screen.getByTestId('settings-trigger');

  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });

  await waitFor(() => expect(screen.getByTestId('dashboard-settings-menu')).toBeTruthy());
}

function renderSettings() {
  return render(
    <DashboardSettings>
      <Button data-testid='settings-trigger' type='button' variant='ghost'>
        Open
      </Button>
    </DashboardSettings>
  );
}

describe('DashboardSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShowWidgetTitles = true;
    mockReadOnly = false;
  });

  it('shows the layout switcher for the Dashboard layout', async () => {
    renderSettings();
    await openMenu();

    expect(screen.getByText('Dashboard settings')).toBeTruthy();
    expect(screen.getByTestId('layout-switcher').getAttribute('data-layout')).toBe(String(DatabaseViewLayout.Dashboard));
  });

  it('hides widget titles when the enabled switch is toggled', async () => {
    renderSettings();
    await openMenu();

    const item = screen.getByTestId('dashboard-settings-show-widget-titles');

    expect(item.textContent).toContain('Show widget titles');
    expect(item.getAttribute('data-checked')).toBe('true');
    expect(item.querySelector('[role="switch"]')?.getAttribute('data-state')).toBe('checked');

    fireEvent.click(item);

    expect(mockUpdateSetting).toHaveBeenCalledWith({ showWidgetTitles: false });
    // The menu stays open so the user can see the new switch state.
    expect(screen.getByTestId('dashboard-settings-menu')).toBeTruthy();
  });

  it('shows widget titles when the disabled switch is toggled', async () => {
    mockShowWidgetTitles = false;
    renderSettings();
    await openMenu();

    const item = screen.getByTestId('dashboard-settings-show-widget-titles');

    expect(item.querySelector('[role="switch"]')?.getAttribute('data-state')).toBe('unchecked');
    fireEvent.click(item);

    expect(mockUpdateSetting).toHaveBeenCalledWith({ showWidgetTitles: true });
  });

  it('does not toggle widget titles for read-only users', async () => {
    mockReadOnly = true;
    renderSettings();
    await openMenu();

    const item = screen.getByTestId('dashboard-settings-show-widget-titles');

    expect(item.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(item);

    expect(mockUpdateSetting).not.toHaveBeenCalled();
  });
});
