import { fireEvent, render, screen } from '@testing-library/react';

import { DatabaseViewLayout } from '@/application/types';
import ChartSettings from '@/components/database/components/settings/ChartSettings';

const mockGetSubscriptions = jest.fn();
const mockUseWorkspaceSubscriptionPlan = jest.fn();

jest.mock('@/application/database-yjs/context', () => ({
  useDatabaseContext: () => ({ workspaceId: 'workspace', getSubscriptions: mockGetSubscriptions, readOnly: false }),
}));

jest.mock('@/components/app/hooks/useWorkspaceSubscriptionPlan', () => ({
  useWorkspaceSubscriptionPlan: (...args: unknown[]) => mockUseWorkspaceSubscriptionPlan(...args),
}));

jest.mock('@/components/database/components/settings/Properties', () => ({
  __esModule: true,
  default: () => <div data-testid='properties-action'>properties</div>,
}));

jest.mock('@/components/database/components/settings/Layout', () => ({
  __esModule: true,
  default: ({ currentLayout }: { currentLayout: DatabaseViewLayout }) => (
    <div data-layout={currentLayout} data-testid='layout-action'>
      layout
    </div>
  ),
}));

jest.mock('@/components/database/components/settings/ChartLayoutSettings', () => ({
  __esModule: true,
  default: () => <div data-testid='chart-layout-settings'>chart</div>,
}));

function renderChartSettings() {
  render(
    <ChartSettings>
      <button type='button'>Settings</button>
    </ChartSettings>
  );
}

async function openChartSettings() {
  renderChartSettings();

  const trigger = screen.getByText('Settings').parentElement as HTMLElement;

  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return screen.findByTestId('chart-settings-panel');
}

describe('ChartSettings', () => {
  beforeEach(() => {
    mockUseWorkspaceSubscriptionPlan.mockReset();
    mockUseWorkspaceSubscriptionPlan.mockReturnValue({ isPro: true, isLoading: false, hasError: false });
  });

  it('opens the desktop 240x550 scrollable chart popover with 8px top padding', async () => {
    const panel = await openChartSettings();

    expect(panel.getAttribute('role')).toBe('menu');
    expect(panel.className).toContain('w-[240px]');
    expect(panel.className).toContain('min-w-[240px]');
    expect(panel.className).toContain('max-h-[min(550px,var(--radix-dropdown-menu-content-available-height))]');
    expect(panel.className).toContain('overflow-y-auto');
    expect(panel.className).toContain('pt-2');
    expect(panel.className).toContain('pb-0');
    expect(panel.className).toContain('px-2');
    expect(panel.className).not.toContain('min-w-[120px]');
  });

  it('lists Properties and Layout without separators, then the inline chart settings', async () => {
    const panel = await openChartSettings();

    expect(panel.textContent).toBe('propertieslayoutchart');
    expect(panel.querySelectorAll('[data-slot="dropdown-menu-separator"]')).toHaveLength(0);
    expect(screen.getByTestId('layout-action').getAttribute('data-layout')).toBe(String(DatabaseViewLayout.Chart));
    expect(screen.getByTestId('chart-layout-settings').closest('[role="group"]')).toBeNull();
  });

  it('does not read the workspace plan while the popover is closed', () => {
    renderChartSettings();

    expect(screen.queryByTestId('chart-settings-panel')).toBeNull();
    // The plan that gates the premium chart types is read by the popover's
    // own chart type grid (see ChartLayoutSettings.test.tsx), not by the
    // always-mounted trigger, so a chart view issues no billing reads on its own.
    expect(mockUseWorkspaceSubscriptionPlan).not.toHaveBeenCalled();
  });
});
