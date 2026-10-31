import { act, fireEvent, render, screen } from '@testing-library/react';

import { ChartGroupSummary } from '@/application/database-yjs/chart-config';
import { DEFAULT_CHART_EXTENDED_SETTINGS } from '@/application/database-yjs/chart-extended-settings';
import { ChartLayoutSettings } from '@/application/database-yjs/chart.type';
import { clearChartGroups, setChartGroups } from '@/components/database/chart/chartGroupsRegistry';
import { ChartSettingsPanel } from '@/components/database/chart/settings/ChartSettingsPanel';
import { GroupsPage } from '@/components/database/chart/settings/pages/GroupsPage';

import { chartSettings } from './panelTestUtils';

const mockUpdate = jest.fn();
let mockSettings: ChartLayoutSettings = chartSettings();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options;
      const template = String(options?.defaultValue ?? key);

      return template.replace(/{{(\w+)}}/g, (_, name: string) => String(options?.[name] ?? ''));
    },
  }),
}));

jest.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(), jest.fn()] }));

jest.mock('@/application/database-yjs', () => ({
  useChartLayoutSetting: () => mockSettings,
  usePropertiesSelector: () => ({ properties: jest.requireActual('./panelTestUtils').PANEL_PROPERTIES }),
  useReadOnly: () => false,
  useDatabaseViewId: () => 'chart-view',
  useDatabaseFields: () => undefined,
}));

jest.mock('@/application/database-yjs/dispatch', () => ({ useUpdateChartSetting: () => mockUpdate }));
jest.mock('@/application/services/domains', () => ({ BillingService: { getWorkspaceSubscriptions: jest.fn() } }));
jest.mock('@/components/app/app.hooks', () => ({ useUserWorkspaceInfo: () => undefined }));
jest.mock('@/components/app/hooks/useServerInfo', () => ({
  useIsOfficialHosted: () => false,
  useServerHostingMode: () => 'self-hosted',
}));
jest.mock('@/components/app/hooks/useSubscriptionPlan', () => ({
  useSubscriptionPlan: () => ({ isPro: true, isLoading: false, hasError: false, loadSubscription: jest.fn() }),
}));
jest.mock('@/components/database/components/field', () => ({ FieldDisplay: () => null }));

const GROUPS: ChartGroupSummary[] = [
  { key: 'o-todo', label: 'Todo', count: 1, isEmpty: false, hidden: false, color: '#5E9FE8' },
  { key: 'o-doing', label: 'Doing', count: 2, isEmpty: false, hidden: true, color: '#EAC26B' },
  { key: 'o-done', label: 'Done', count: 3, isEmpty: false, hidden: false, color: '#72BC8F' },
];

function renderPage(
  groups: ChartGroupSummary[] | undefined = GROUPS,
  hiddenGroups: string[] = (groups ?? []).filter((group) => group.hidden).map((group) => group.key)
) {
  const onHiddenChange = jest.fn();
  const onReorder = jest.fn();

  render(
    <GroupsPage
      title='Groups'
      groups={groups}
      hiddenGroups={hiddenGroups}
      onHiddenChange={onHiddenChange}
      onReorder={onReorder}
      onBack={jest.fn()}
    />
  );
  return { onHiddenChange, onReorder };
}

describe('GroupsPage', () => {
  it('lists every group in order with its count, hidden ones dimmed', () => {
    renderPage();

    expect(screen.getAllByRole('listitem').map((item) => item.getAttribute('data-testid'))).toEqual([
      'chart-group-o-todo',
      'chart-group-o-doing',
      'chart-group-o-done',
    ]);
    expect(screen.getByTestId('chart-groups-count').textContent).toBe('3 groups');
    expect(screen.getByTestId('chart-group-o-doing').getAttribute('data-hidden')).toBe('true');
    expect(screen.getByTestId('chart-group-eye-o-doing').getAttribute('aria-label')).toBe('Show group');
    expect(screen.getByTestId('chart-group-eye-o-todo').getAttribute('aria-label')).toBe('Hide group');
    expect(screen.getByTestId('chart-group-handle-o-todo')).toBeTruthy();
  });

  it('toggles a group in hidden_groups', () => {
    const { onHiddenChange } = renderPage();

    fireEvent.click(screen.getByTestId('chart-group-eye-o-todo'));
    expect(onHiddenChange).toHaveBeenLastCalledWith(['o-doing', 'o-todo']);
    fireEvent.click(screen.getByTestId('chart-group-eye-o-doing'));
    expect(onHiddenChange).toHaveBeenLastCalledWith([]);
  });

  it('keeps hidden keys that match no listed group, like desktop', () => {
    // `o-gone` belongs to an option that no longer has rows; it stays hidden.
    const { onHiddenChange } = renderPage(GROUPS, ['o-gone', 'o-doing']);

    fireEvent.click(screen.getByTestId('chart-group-eye-o-todo'));
    expect(onHiddenChange).toHaveBeenLastCalledWith(['o-gone', 'o-doing', 'o-todo']);
    fireEvent.click(screen.getByTestId('chart-group-eye-o-doing'));
    expect(onHiddenChange).toHaveBeenLastCalledWith(['o-gone']);
  });

  it('adds every listed key to the stored ones with Hide all', () => {
    const { onHiddenChange } = renderPage(
      GROUPS.map((group) => ({ ...group, hidden: false })),
      ['o-gone']
    );

    fireEvent.click(screen.getByTestId('chart-groups-hide-all'));
    expect(onHiddenChange).toHaveBeenLastCalledWith(['o-gone', 'o-todo', 'o-doing', 'o-done']);
  });

  it('offers Show all while a group is hidden, and Hide all otherwise', () => {
    const { onHiddenChange } = renderPage();

    expect(screen.queryByTestId('chart-groups-hide-all')).toBeNull();
    fireEvent.click(screen.getByTestId('chart-groups-show-all'));
    expect(onHiddenChange).toHaveBeenLastCalledWith([]);
  });

  it('hides every listed key with Hide all', () => {
    const { onHiddenChange } = renderPage(GROUPS.map((group) => ({ ...group, hidden: false })));

    expect(screen.queryByTestId('chart-groups-show-all')).toBeNull();
    fireEvent.click(screen.getByTestId('chart-groups-hide-all'));
    expect(onHiddenChange).toHaveBeenLastCalledWith(['o-todo', 'o-doing', 'o-done']);
  });

  it('moves a focused row one step with Alt+↓ and Alt+↑', () => {
    const { onReorder } = renderPage();

    fireEvent.keyDown(screen.getByTestId('chart-group-o-todo'), { key: 'ArrowDown', altKey: true });
    expect(onReorder).toHaveBeenLastCalledWith(['o-doing', 'o-todo', 'o-done']);
    fireEvent.keyDown(screen.getByTestId('chart-group-o-done'), { key: 'ArrowUp', altKey: true });
    expect(onReorder).toHaveBeenLastCalledWith(['o-todo', 'o-done', 'o-doing']);
    // The first row cannot move up; a plain arrow does nothing.
    onReorder.mockClear();
    fireEvent.keyDown(screen.getByTestId('chart-group-o-todo'), { key: 'ArrowUp', altKey: true });
    fireEvent.keyDown(screen.getByTestId('chart-group-o-todo'), { key: 'ArrowDown' });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('says No groups while the chart has none', () => {
    renderPage([]);
    expect(screen.getByTestId('chart-groups-empty').textContent).toBe('No groups');
    expect(screen.queryByTestId('chart-groups-hide-all')).toBeNull();
  });
});

describe('GroupsPage in the panel', () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    // The stored hidden_groups agree with the published groups (Doing hidden).
    mockSettings = chartSettings({ extended: { ...DEFAULT_CHART_EXTENDED_SETTINGS, hiddenGroups: ['o-doing'] } });
    act(() => setChartGroups('chart-view', GROUPS));
  });

  // The panel is still mounted here: its re-render belongs in act.
  afterEach(() => act(() => clearChartGroups('chart-view')));

  it('writes the manual sort and the new order in one update', () => {
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-row-x-groups'));
    fireEvent.keyDown(screen.getByTestId('chart-group-o-done'), { key: 'ArrowUp', altKey: true });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({}, { xSort: 'manual', xManualOrder: ['o-todo', 'o-done', 'o-doing'] });
  });

  it('writes hidden_groups alone for an eye toggle', () => {
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-row-x-groups'));
    fireEvent.click(screen.getByTestId('chart-group-eye-o-done'));

    expect(mockUpdate).toHaveBeenCalledWith({}, { hiddenGroups: ['o-doing', 'o-done'] });
  });
});
