import { fireEvent, render, screen } from '@testing-library/react';

import { DatabaseViewLayout } from '@/application/types';
import ChartSettings, { ChartSettingsItems } from '@/components/database/components/settings/ChartSettings';

const mockRenderPanel = jest.fn();
let mockReadOnly = false;

jest.mock('@/application/database-yjs', () => ({
  useReadOnly: () => mockReadOnly,
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

jest.mock('@/components/database/chart/settings/ChartSettingsPanel', () => ({
  ChartSettingsPanel: () => {
    mockRenderPanel();
    return <div data-testid='chart-settings-panel'>chart</div>;
  },
}));

function renderChartSettings() {
  render(
    <ChartSettings>
      <button type='button'>Settings</button>
    </ChartSettings>
  );
}

async function openSettingsMenu() {
  renderChartSettings();

  fireEvent.keyDown(screen.getByText('Settings').parentElement as HTMLElement, { key: 'ArrowDown' });
  return screen.findByRole('menu');
}

describe('ChartSettings hosts', () => {
  beforeEach(() => {
    mockRenderPanel.mockClear();
    mockReadOnly = false;
  });

  it('lists Properties and Layout and mounts the chart panel only when its submenu opens', async () => {
    await openSettingsMenu();

    expect(screen.getByTestId('properties-action')).toBeTruthy();
    expect(screen.getByTestId('layout-action').getAttribute('data-layout')).toBe(String(DatabaseViewLayout.Chart));
    expect(mockRenderPanel).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId('chart-settings-trigger'), { key: 'ArrowRight' });
    const panel = await screen.findByTestId('chart-settings-panel');

    expect(panel.closest('[role="menu"]')?.className).toContain('w-[300px]');
    expect(mockRenderPanel).toHaveBeenCalled();
  });

  it('does not mount the panel or its subscription hook while the gear menu is closed', () => {
    renderChartSettings();

    expect(screen.queryByTestId('chart-settings-panel')).toBeNull();
    expect(mockRenderPanel).not.toHaveBeenCalled();
  });

  it('hides the chart settings submenu for readers', async () => {
    mockReadOnly = true;
    await openSettingsMenu();

    expect(screen.queryByTestId('chart-settings-trigger')).toBeNull();
    expect(mockRenderPanel).not.toHaveBeenCalled();
  });

  it('embeds the same panel after Properties and Layout in a dashboard widget', () => {
    const { container } = render(<ChartSettingsItems />);

    expect(container.textContent).toBe('propertieslayoutchart');
    expect(screen.getByTestId('chart-settings-panel')).toBeTruthy();
    expect(screen.getByTestId('layout-action').getAttribute('data-layout')).toBe(String(DatabaseViewLayout.Chart));
  });
});
