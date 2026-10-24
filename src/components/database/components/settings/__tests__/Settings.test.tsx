import { act, fireEvent, render, screen } from '@testing-library/react';

import { DatabaseViewLayout } from '@/application/types';
import Settings from '@/components/database/components/settings/Settings';

jest.mock('@/components/database/components/settings/GridSettings', () => ({
  __esModule: true,
  default: () => <div data-testid='grid-settings' />,
}));

jest.mock('@/components/database/components/settings/BoardSettings', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/database/components/settings/CalendarSettings', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/database/components/settings/ChartSettings', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/database/components/settings/ListSettings', () => ({
  __esModule: true,
  default: () => <div data-testid='list-settings' />,
}));

jest.mock('@/components/database/components/settings/GallerySettings', () => ({
  __esModule: true,
  default: () => <div data-testid='gallery-settings' />,
}));

jest.mock('@/components/database/components/settings/FeedSettings', () => ({
  __esModule: true,
  default: () => <div data-testid='feed-settings' />,
}));

jest.mock('@/components/database/components/settings/TimelineSettings', () => ({
  __esModule: true,
  default: () => null,
}));

// The real Chart settings menu (below) with its rows stubbed: Properties, Layout and the panel.
let mockChartReadOnly = false;

jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs'),
  useReadOnly: () => mockChartReadOnly,
}));

jest.mock('@/components/database/components/settings/Properties', () => ({
  __esModule: true,
  default: () => <div role='menuitem' data-testid='properties-row' />,
}));

jest.mock('@/components/database/components/settings/Layout', () => ({
  __esModule: true,
  default: () => <div role='menuitem' data-testid='layout-row' />,
}));

jest.mock('@/components/database/chart/settings/ChartSettingsPanel', () => ({
  ChartSettingsPanel: () => <div data-testid='chart-settings-panel' />,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/components/database/components/settings/DashboardSettings', () => ({
  __esModule: true,
  default: () => <div data-testid='dashboard-settings' />,
}));

describe('database Settings', () => {
  it('renders nothing while the database layout is unresolved', () => {
    const { container } = render(
      <Settings layout={undefined as unknown as DatabaseViewLayout}>
        <button type='button'>Settings</button>
      </Settings>
    );

    expect(container.firstChild).toBeNull();
  });

  it('uses the List settings menu for a List view', () => {
    render(
      <Settings layout={DatabaseViewLayout.List}>
        <button type='button'>Settings</button>
      </Settings>
    );

    expect(screen.getByTestId('list-settings')).toBeTruthy();
    expect(screen.queryByTestId('grid-settings')).toBeNull();
  });

  it('uses the Feed settings menu for a Feed view', () => {
    render(
      <Settings layout={DatabaseViewLayout.Feed}>
        <button type='button'>Settings</button>
      </Settings>
    );

    expect(screen.getByTestId('feed-settings')).toBeTruthy();
    expect(screen.queryByTestId('grid-settings')).toBeNull();
  });

  it('uses the Gallery settings menu for a Gallery view', async () => {
    render(
      <Settings layout={DatabaseViewLayout.Gallery}>
        <button type='button'>Settings</button>
      </Settings>
    );

    expect(await screen.findByTestId('gallery-settings')).toBeTruthy();
    expect(screen.queryByTestId('grid-settings')).toBeNull();
  });

  it('uses the Dashboard settings menu for a Dashboard view', () => {
    render(
      <Settings layout={DatabaseViewLayout.Dashboard}>
        <button type='button'>Settings</button>
      </Settings>
    );

    expect(screen.getByTestId('dashboard-settings')).toBeTruthy();
    expect(screen.queryByTestId('grid-settings')).toBeNull();
  });
});

describe('Chart settings', () => {
  const { default: RealChartSettings, ChartSettingsItems } = jest.requireActual(
    '@/components/database/components/settings/ChartSettings'
  ) as typeof import('@/components/database/components/settings/ChartSettings');

  afterEach(() => {
    mockChartReadOnly = false;
  });

  it('keeps Properties and Layout in the gear menu, and opens the panel from "Chart settings ›"', async () => {
    render(
      <RealChartSettings>
        <button type='button'>Settings</button>
      </RealChartSettings>
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Settings' }), { key: 'Enter' });
    expect(await screen.findByTestId('properties-row')).toBeTruthy();
    expect(screen.getByTestId('layout-row')).toBeTruthy();
    const trigger = screen.getByTestId('chart-settings-trigger');

    expect(trigger.textContent).toContain('Chart settings');
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    const panel = await screen.findByTestId('chart-settings-panel');
    const submenu = panel.closest('[role="menu"]') as HTMLElement;

    expect(submenu.className).toContain('w-[300px]');
    expect(submenu.className).toContain('p-0');
  });

  it('hides "Chart settings ›" from readers', async () => {
    mockChartReadOnly = true;
    render(
      <RealChartSettings>
        <button type='button'>Settings</button>
      </RealChartSettings>
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Settings' }), { key: 'Enter' });
    expect(await screen.findByTestId('layout-row')).toBeTruthy();
    expect(screen.queryByTestId('chart-settings-trigger')).toBeNull();
  });

  it('puts the panel itself under Properties and Layout in a widget settings host', () => {
    render(<ChartSettingsItems />);

    const rows = [screen.getByTestId('properties-row'), screen.getByTestId('layout-row'), screen.getByTestId('chart-settings-panel')];

    rows.slice(1).forEach((row, index) =>
      expect(rows[index].compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    );
  });
});
