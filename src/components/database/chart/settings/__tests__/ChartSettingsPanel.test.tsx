import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ChartAggregationType, ChartLayoutSettings, ChartType } from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { SubscriptionPlan } from '@/application/types';
import { clearChartGroups, setChartGroups } from '@/components/database/chart/chartGroupsRegistry';
import { ChartSettingsPanel } from '@/components/database/chart/settings/ChartSettingsPanel';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { chartSettings, PANEL_PROPERTIES, readPanelSections } from './panelTestUtils';

const mockUpdate = jest.fn();
let mockReadOnly = false;
let mockIsPro = true;
let mockHosted = false;
let mockPlanLoading = false;
let mockWorkspaceId = 'workspace-1';
let mockViewId = 'chart-view';
let mockSettings: ChartLayoutSettings = chartSettings();
const mockSetSearch = jest.fn();
const mockLoadSubscription = jest.fn();
const mockUseSubscriptionPlan = jest.fn(() => ({
  isPro: mockIsPro,
  isLoading: mockPlanLoading,
  hasError: false,
  loadSubscription: mockLoadSubscription,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options;
      const template = String(options?.defaultValue ?? key);

      return template.replace(/{{(\w+)}}/g, (_, name: string) => String(options?.[name] ?? ''));
    },
  }),
}));

jest.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), mockSetSearch],
}));

jest.mock('@/application/database-yjs', () => ({
  useChartLayoutSetting: () => mockSettings,
  usePropertiesSelector: () => ({ properties: jest.requireActual('./panelTestUtils').PANEL_PROPERTIES }),
  useReadOnly: () => mockReadOnly,
  useDatabaseViewId: () => mockViewId,
  useDatabaseFields: () => ({ get: (id: string) => ({ get: (key: string) => key === 'is_primary' && id === 'name' }) }),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateChartSetting: () => mockUpdate,
}));

jest.mock('@/application/services/domains', () => ({
  BillingService: { getWorkspaceSubscriptions: jest.fn() },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useUserWorkspaceInfo: () => ({ selectedWorkspace: { id: mockWorkspaceId } }),
}));

jest.mock('@/components/app/hooks/useServerInfo', () => ({
  useIsOfficialHosted: () => mockHosted,
  useServerHostingMode: () => (mockHosted ? 'cloud' : 'self-hosted'),
}));

jest.mock('@/components/app/hooks/useSubscriptionPlan', () => ({
  useSubscriptionPlan: (...args: unknown[]) => mockUseSubscriptionPlan(...args),
}));

jest.mock('@/components/database/components/field', () => ({
  FieldDisplay: ({ fieldId }: { fieldId: string }) => <span>{fieldId}</span>,
}));

function panel() {
  return screen.getByTestId('chart-settings-panel');
}

function sections() {
  return readPanelSections(panel()).map(({ title, rows }) => ({ title, rows }));
}

function sectionRows(title: string) {
  return readPanelSections(panel()).find((section) => section.title === title)?.labels ?? [];
}

beforeEach(() => {
  mockUpdate.mockReset();
  mockSetSearch.mockReset();
  mockReadOnly = false;
  mockIsPro = true;
  mockHosted = false;
  mockPlanLoading = false;
  mockWorkspaceId = 'workspace-1';
  mockViewId = 'chart-view';
  mockLoadSubscription.mockReset();
  mockUseSubscriptionPlan.mockClear();
  mockSettings = chartSettings();
  clearChartGroups('chart-view');
});

describe('ChartSettingsPanel sections', () => {
  it('shows the chart type icons, then X axis, Y axis and Style for a vertical bar', () => {
    render(<ChartSettingsPanel />);

    const row = screen.getByTestId('chart-type-row');

    expect(within(row).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Vertical bar',
      'Horizontal bar',
      'Line',
      'Donut',
      'Number',
    ]);
    expect(screen.getByTestId('chart-type-bar').getAttribute('aria-pressed')).toBe('true');
    expect(sections().map((section) => section.title)).toEqual(['Chart type', 'X axis', 'Y axis', 'Style']);
    expect(sectionRows('X axis')).toEqual(['What to show', 'Sort by', 'Groups', 'Show empty values']);
    // WP12: Group by sits between Decimal places and Cumulative.
    expect(sectionRows('Y axis')).toEqual(['What to show', 'Group by', 'Cumulative']);
    expect(sectionRows('Style')).toEqual(['Color', 'Data labels', 'Legend']);
  });

  it('puts the value section first and calls it X axis on a horizontal bar', () => {
    mockSettings = chartSettings({ chartType: ChartType.HorizontalBar });
    render(<ChartSettingsPanel />);

    expect(sections().map((section) => section.title)).toEqual(['Chart type', 'X axis', 'Y axis', 'Style']);
    expect(sectionRows('X axis')).toEqual(['What to show', 'Group by', 'Cumulative']);
    expect(sectionRows('Y axis')).toEqual(['What to show', 'Sort by', 'Groups', 'Show empty values']);
  });

  it('has one Data section with "Each slice represents" and no Cumulative on a donut', () => {
    mockSettings = chartSettings({ chartType: ChartType.Donut, cumulative: true });
    render(<ChartSettingsPanel />);

    expect(sections().map((section) => section.title)).toEqual(['Chart type', 'Data', 'Style']);
    expect(sectionRows('Data')).toEqual(['What to show', 'Each slice represents', 'Sort by', 'Groups', 'Show empty values']);
    expect(sectionRows('Style')).toEqual(['Color', 'Legend']);
    expect(screen.queryByTestId('chart-settings-row-y-cumulative')).toBeNull();
  });

  it('shows the title, Data and Style sections on a Number chart', () => {
    mockSettings = chartSettings({ chartType: ChartType.Number });
    render(<ChartSettingsPanel />);

    expect(sections().map((section) => section.title)).toEqual(['Chart type', '', 'Data', 'Style']);
    expect(screen.getByTestId('chart-number-title-toggle').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('chart-number-title-input')).toBeTruthy();
    expect(sectionRows('Data')).toEqual(['What to show', 'Calculate', 'Format']);
    // Count all: Calculate shows "Count all" and cannot be opened.
    const calculate = screen.getByTestId('chart-settings-row-y-calculate');

    expect((calculate as HTMLButtonElement).disabled).toBe(true);
    expect(calculate.textContent).toContain('Count all');
    expect(sectionRows('Style')).toEqual(['Color']);
  });

  it('offers Calculate only once a Y property is picked, and Date grouping and Ranges by the X type', () => {
    const { rerender } = render(<ChartSettingsPanel />);

    expect(screen.queryByTestId('chart-settings-row-y-calculate')).toBeNull();
    mockSettings = chartSettings({ yFieldId: 'estimate', aggregationType: ChartAggregationType.Sum, xFieldId: 'due' });
    rerender(<ChartSettingsPanel />);
    expect(screen.getByTestId('chart-settings-row-y-calculate').textContent).toContain('Sum');
    expect(screen.getByTestId('chart-settings-row-x-date-grouping')).toBeTruthy();
    expect(screen.getByTestId('chart-settings-row-y-decimals')).toBeTruthy();

    mockSettings = chartSettings({ xFieldId: 'estimate' });
    rerender(<ChartSettingsPanel />);
    expect(screen.getByTestId('chart-settings-row-x-buckets').textContent).toContain('Auto');
    mockSettings = chartSettings({ xFieldId: 'name' });
    rerender(<ChartSettingsPanel />);
    expect(screen.getByTestId('chart-settings-row-x-text-grouping').textContent).toContain('Exact value');
  });

  it('carries the parity ids of the rows, the What to show row and the type buttons', () => {
    render(<ChartSettingsPanel />);

    expect(screen.getByTestId('chart-type-row').getAttribute('data-parity-id')).toBe('dash-chart-type-row');
    expect(screen.getByTestId('chart-type-donut').getAttribute('data-parity-id')).toBe('dash-chart-type-button-donut');
    expect(panel().querySelector('[data-parity-id="dash-chart-type-button-number__icon"]')).toBeTruthy();
    expect(screen.getByTestId('chart-settings-row-x-what').getAttribute('data-parity-id')).toBe(
      'dash-chart-panel-row-what-to-show'
    );
    expect(
      screen.getByTestId('chart-settings-row-x-what').querySelector('[data-parity-id="dash-chart-panel-row-what-to-show__icon"]')
    ).toBeTruthy();
    expect(screen.getByTestId('chart-settings-row-x-sort').getAttribute('data-parity-id')).toBe('dash-chart-panel-row');
    expect(
      screen.getByTestId('chart-settings-row-x-sort').querySelector('[data-parity-id="dash-chart-panel-row__chevron"]')
    ).toBeTruthy();
  });

  it('renders nothing for a reader', () => {
    mockReadOnly = true;
    const { container } = render(<ChartSettingsPanel />);

    expect(container.firstChild).toBeNull();
  });
});

describe('ChartSettingsPanel writes', () => {
  it('picks a chart type with one write', () => {
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-type-donut'));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ chartType: ChartType.Donut }, undefined);
  });

  it('locks the premium types behind the upgrade prompt without Pro', () => {
    mockIsPro = false;
    mockHosted = true;
    render(<ChartSettingsPanel />);

    expect(screen.getByTestId('chart-type-line-crown')).toBeTruthy();
    expect(screen.queryByTestId('chart-type-bar-crown')).toBeNull();
    fireEvent.click(screen.getByTestId('chart-type-line'));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetSearch).toHaveBeenCalledTimes(1);
  });

  it('shares the workspace plan request with the add-widget flow', () => {
    render(<ChartSettingsPanel />);

    expect(mockUseSubscriptionPlan).toHaveBeenCalledWith(expect.any(Function), { cacheKey: 'dashboard-plan:workspace-1' });
  });

  it('keeps the Line chart of a workspace without Pro selected, crown and all (desktop parity)', () => {
    mockIsPro = false;
    mockHosted = true;
    mockSettings = chartSettings({ chartType: ChartType.Line });
    render(<ChartSettingsPanel />);

    const line = screen.getByTestId('chart-type-line');

    expect(line.getAttribute('aria-pressed')).toBe('true');
    expect(line.getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('chart-type-line-crown')).toBeTruthy();
  });

  it('locks nothing while the plan loads, and resolves a premium pick from the plan', async () => {
    mockIsPro = false;
    mockHosted = true;
    mockPlanLoading = true;
    mockSettings = chartSettings({ chartType: ChartType.Line });
    mockLoadSubscription.mockResolvedValueOnce(SubscriptionPlan.Pro).mockResolvedValueOnce(SubscriptionPlan.Free);
    render(<ChartSettingsPanel />);

    expect(screen.getByTestId('chart-type-line').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('chart-type-line-crown')).toBeNull();
    expect(screen.queryByTestId('chart-type-donut-crown')).toBeNull();

    // A Pro plan: the pick goes through.
    fireEvent.click(screen.getByTestId('chart-type-donut'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ chartType: ChartType.Donut }, undefined));
    expect(mockSetSearch).not.toHaveBeenCalled();

    // A Free plan: the upgrade prompt.
    fireEvent.click(screen.getByTestId('chart-type-donut'));
    await waitFor(() => expect(mockSetSearch).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockLoadSubscription).toHaveBeenCalledTimes(2);
  });

  it.each(['close', 'workspace', 'view'] as const)('ignores a premium choice after a %s transition', async (transition) => {
    mockHosted = true;
    mockIsPro = false;
    mockPlanLoading = true;
    let resolve!: (plan: SubscriptionPlan) => void;

    mockLoadSubscription.mockReturnValue(new Promise<SubscriptionPlan>((done) => { resolve = done; }));
    const { rerender, unmount } = render(<ChartSettingsPanel />);

    fireEvent.click(screen.getByTestId('chart-type-line'));
    if (transition === 'close') unmount();
    else {
      if (transition === 'workspace') mockWorkspaceId = 'workspace-2';
      else mockViewId = 'other-chart';
      rerender(<ChartSettingsPanel />);
    }

    await act(async () => { resolve(SubscriptionPlan.Free); });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetSearch).not.toHaveBeenCalled();
  });

  it('keeps the last chart choice when premium plan requests finish out of order', async () => {
    mockHosted = true;
    mockIsPro = false;
    mockPlanLoading = true;
    let first!: (plan: SubscriptionPlan) => void;
    let second!: (plan: SubscriptionPlan) => void;

    mockLoadSubscription
      .mockReturnValueOnce(new Promise<SubscriptionPlan>((done) => { first = done; }))
      .mockReturnValueOnce(new Promise<SubscriptionPlan>((done) => { second = done; }));
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-type-line'));
    fireEvent.click(screen.getByTestId('chart-type-donut'));
    await act(async () => { second(SubscriptionPlan.Pro); });
    await act(async () => { first(SubscriptionPlan.Free); });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ chartType: ChartType.Donut }, undefined);
    expect(mockSetSearch).not.toHaveBeenCalled();
  });

  it('a free choice supersedes a pending premium choice', async () => {
    mockHosted = true;
    mockIsPro = false;
    mockPlanLoading = true;
    let resolve!: (plan: SubscriptionPlan) => void;

    mockLoadSubscription.mockReturnValue(new Promise<SubscriptionPlan>((done) => { resolve = done; }));
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-type-line'));
    fireEvent.click(screen.getByTestId('chart-type-bar'));
    await act(async () => { resolve(SubscriptionPlan.Pro); });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ chartType: ChartType.Bar }, undefined);
  });

  it('does not treat a cancelled or failed plan resolution as a Free subscription', async () => {
    mockHosted = true;
    mockIsPro = false;
    mockPlanLoading = true;
    mockLoadSubscription.mockResolvedValue(null);
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-type-line'));
    await act(async () => undefined);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetSearch).not.toHaveBeenCalled();
  });

  it('writes the default aggregation of a picked Y property', () => {
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-row-y-what'));
    fireEvent.click(screen.getByTestId('chart-field-urgent'));
    expect(mockUpdate).toHaveBeenCalledWith({ yFieldId: 'urgent', aggregationType: ChartAggregationType.PercentChecked }, undefined);
    // Back on the root page.
    expect(screen.getByTestId('chart-settings-panel').getAttribute('data-page')).toBe('root');
  });

  it('clears the property when Count all is picked', () => {
    mockSettings = chartSettings({ yFieldId: 'estimate', aggregationType: ChartAggregationType.Sum });
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-row-y-what'));
    fireEvent.click(screen.getByTestId('chart-field-none'));
    expect(mockUpdate).toHaveBeenCalledWith({ aggregationType: 0, yFieldId: '' }, undefined);
  });

  it('resets the groups when the X property changes', () => {
    mockSettings = chartSettings({ extended: { xSort: 'manual', hiddenGroups: ['o-a'], xManualOrder: ['o-b'] } as never });
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-row-x-what'));
    // Only X-eligible properties are listed, in view order.
    expect(
      screen.getAllByRole('menuitemradio').map((item) => item.getAttribute('data-testid'))
    ).toEqual(['chart-field-name', 'chart-field-status', 'chart-field-estimate', 'chart-field-due', 'chart-field-urgent']);
    fireEvent.click(screen.getByTestId('chart-field-due'));
    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'due' }, { hiddenGroups: [], xManualOrder: [], xSort: 'auto' });
  });

  it('searches the properties and says No results', () => {
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-row-x-what'));
    const search = screen.getByTestId('chart-field-search');

    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: 'EST' } });
    expect(screen.getAllByRole('menuitemradio').map((item) => item.getAttribute('data-field-name'))).toEqual(['Estimate']);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByTestId('chart-field-no-results').textContent).toBe('No results');
  });

  it('lists the Calculate groups of the Y type and writes the pick', () => {
    mockSettings = chartSettings({ yFieldId: 'urgent', aggregationType: ChartAggregationType.PercentChecked });
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-row-y-calculate'));
    expect(screen.getByTestId('chart-agg-group-count').textContent).toContain('Count');
    expect(screen.queryByTestId('chart-agg-group-more')).toBeNull();
    expect(screen.getByTestId('chart-agg-11').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('chart-agg-8'));
    expect(mockUpdate).toHaveBeenCalledWith({ aggregationType: 8 }, undefined);
  });

  it('sorts, groups text and sets the ranges with their reset', () => {
    mockSettings = chartSettings({ xFieldId: 'estimate' });
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-row-x-sort'));
    fireEvent.click(screen.getByTestId('chart-option-x-sort-value_desc'));
    expect(mockUpdate).toHaveBeenLastCalledWith({}, { xSort: 'value_desc' });

    fireEvent.click(screen.getByTestId('chart-settings-back'));
    fireEvent.click(screen.getByTestId('chart-settings-row-x-buckets'));
    const size = screen.getByTestId('chart-bucket-size');

    fireEvent.change(size, { target: { value: '5' } });
    fireEvent.keyDown(size, { key: 'Enter' });
    expect(mockUpdate).toHaveBeenLastCalledWith(
      {},
      { xNumberBucketSize: 5, xNumberBucketMin: null, xNumberBucketMax: null, hiddenGroups: [], xManualOrder: [] }
    );
    // Invalid input reverts and writes nothing.
    mockUpdate.mockClear();
    fireEvent.change(size, { target: { value: 'abc' } });
    fireEvent.blur(size);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect((size as HTMLInputElement).value).toBe('');
  });

  it('toggles cumulative and show empty values', () => {
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-row-y-cumulative'));
    expect(mockUpdate).toHaveBeenLastCalledWith({ cumulative: true }, undefined);
    fireEvent.keyDown(screen.getByTestId('chart-settings-row-x-show-empty'), { key: ' ' });
    expect(mockUpdate).toHaveBeenLastCalledWith({ showEmptyValues: false }, undefined);
  });

  it('writes the style rows: color theme, data labels, legend and decimal places', () => {
    mockSettings = chartSettings({
      yFieldId: 'estimate',
      aggregationType: ChartAggregationType.Sum,
      extended: { decimalPlaces: 3 } as never,
    });
    render(<ChartSettingsPanel />);

    fireEvent.click(screen.getByTestId('chart-settings-row-style-color'));
    expect(screen.getAllByTestId(/^chart-option-style-color-/).map((item) => item.getAttribute('data-testid'))).toEqual(
      ['auto', 'colorful', 'colorless', 'blue', 'yellow', 'green', 'purple', 'teal', 'orange', 'pink', 'red'].map(
        (theme) => `chart-option-style-color-${theme}`
      )
    );
    fireEvent.click(screen.getByTestId('chart-option-style-color-blue'));
    expect(mockUpdate).toHaveBeenLastCalledWith({}, { colorTheme: 'blue' });
    fireEvent.click(screen.getByTestId('chart-settings-back'));

    fireEvent.click(screen.getByTestId('chart-settings-row-style-data-labels'));
    expect(mockUpdate).toHaveBeenLastCalledWith({}, { showDataLabels: false });

    fireEvent.click(screen.getByTestId('chart-settings-row-style-legend'));
    fireEvent.click(screen.getByTestId('chart-option-style-legend-off'));
    expect(mockUpdate).toHaveBeenLastCalledWith({}, { legendPosition: 'off' });
    fireEvent.click(screen.getByTestId('chart-settings-back'));

    expect(screen.getByTestId('chart-settings-row-y-decimals').textContent).toContain('3');
    fireEvent.click(screen.getByTestId('chart-settings-row-y-decimals'));
    expect(screen.getByTestId('chart-option-y-decimals-2').textContent).toBe('1.00');
    fireEvent.click(screen.getByTestId('chart-option-y-decimals-2'));
    expect(mockUpdate).toHaveBeenLastCalledWith({}, { decimalPlaces: 2 });
    fireEvent.click(screen.getByTestId('chart-option-y-decimals-default'));
    expect(mockUpdate).toHaveBeenLastCalledWith({}, { decimalPlaces: null });
  });

  it('turns the Number chart title off', () => {
    mockSettings = chartSettings({ chartType: ChartType.Number });
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-number-title-toggle'));
    expect(mockUpdate).toHaveBeenCalledWith({}, { showTitle: false });
  });

  it('shows how many groups are visible', () => {
    act(() =>
      setChartGroups('chart-view', [
        { key: 'o-a', label: 'A', count: 1, isEmpty: false, hidden: false },
        { key: 'o-b', label: 'B', count: 2, isEmpty: false, hidden: true },
      ])
    );
    render(<ChartSettingsPanel />);
    expect(screen.getByTestId('chart-settings-row-x-groups').textContent).toContain('1 of 2');
  });
});

describe('ChartSettingsPanel Group by (WP12)', () => {
  it('shows Group by as None, and Group style only once a Group by is effective', () => {
    render(<ChartSettingsPanel />);

    expect(screen.getByTestId('chart-settings-group-by').textContent).toContain('None');
    expect(screen.queryByTestId('chart-group-style')).toBeNull();
  });

  it('picks a Group by on its page, without the X property, writing only group_by_field_id', () => {
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-group-by'));
    expect(panel().getAttribute('data-page')).toBe('y_group_by');
    expect(
      screen.getAllByRole('menuitemradio').map((item) => item.getAttribute('data-testid'))
    ).toEqual([
      'chart-group-by-option-none',
      'chart-group-by-option-name',
      'chart-group-by-option-estimate',
      'chart-group-by-option-due',
      'chart-group-by-option-urgent',
    ]);
    fireEvent.click(screen.getByTestId('chart-group-by-option-urgent'));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({}, { groupByFieldId: 'urgent' });
    expect(panel().getAttribute('data-page')).toBe('root');
  });

  it('shows the Group by and the group styles of a grouped bar chart and writes a style', () => {
    mockSettings = chartSettings({ extended: { groupByFieldId: 'urgent', groupStyle: 'grouped' } as never });
    render(<ChartSettingsPanel />);

    expect(screen.getByTestId('chart-settings-group-by').textContent).toContain('Urgent');
    expect(sectionRows('Y axis')).toEqual(['What to show', 'Group by', 'Group style', 'Cumulative']);
    expect(screen.getByTestId('chart-group-style-grouped').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('chart-group-style-percent'));
    expect(mockUpdate).toHaveBeenCalledWith({}, { groupStyle: 'percent' });
  });

  it('clears the Group by in the same write when its property becomes X', () => {
    mockSettings = chartSettings({ extended: { groupByFieldId: 'urgent' } as never });
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-row-x-what'));
    fireEvent.click(screen.getByTestId('chart-field-urgent'));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'urgent' }, { hiddenGroups: [], xManualOrder: [], groupByFieldId: '' });
  });

  it('picks None to stop grouping', () => {
    mockSettings = chartSettings({ extended: { groupByFieldId: 'urgent' } as never });
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-group-by'));
    fireEvent.click(screen.getByTestId('chart-group-by-option-none'));
    expect(mockUpdate).toHaveBeenCalledWith({}, { groupByFieldId: '' });
  });

  it('hides both rows on a donut and a Number chart, keeping the stored Group by', () => {
    mockSettings = chartSettings({ chartType: ChartType.Donut, extended: { groupByFieldId: 'urgent' } as never });
    const { unmount } = render(<ChartSettingsPanel />);

    expect(screen.queryByTestId('chart-settings-group-by')).toBeNull();
    expect(screen.queryByTestId('chart-group-style')).toBeNull();
    unmount();
    mockSettings = chartSettings({ chartType: ChartType.Number, extended: { groupByFieldId: 'urgent' } as never });
    render(<ChartSettingsPanel />);
    expect(screen.queryByTestId('chart-settings-group-by')).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('shows Group by on a line chart but never Group style', () => {
    mockSettings = chartSettings({ chartType: ChartType.Line, extended: { groupByFieldId: 'urgent' } as never });
    render(<ChartSettingsPanel />);

    expect(screen.getByTestId('chart-settings-group-by').textContent).toContain('Urgent');
    expect(screen.queryByTestId('chart-group-style')).toBeNull();
  });
});

describe('ChartSettingsPanel keyboard', () => {
  it('goes back to the root on Escape and focuses the row that opened the page', () => {
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-row-x-sort'));
    expect(panel().getAttribute('data-page')).toBe('x_sort');

    fireEvent.keyDown(screen.getByTestId('chart-option-x-sort-auto'), { key: 'Escape' });
    expect(panel().getAttribute('data-page')).toBe('root');
    expect(document.activeElement).toBe(screen.getByTestId('chart-settings-row-x-sort'));
  });

  it('keeps keys inside the panel, except an Escape on the root', () => {
    const onKeyDown = jest.fn();

    render(
      <div onKeyDown={(event) => onKeyDown(event.key)}>
        <ChartSettingsPanel />
      </div>
    );
    fireEvent.click(screen.getByTestId('chart-settings-row-x-what'));
    fireEvent.keyDown(screen.getByTestId('chart-field-search'), { key: 'a' });
    fireEvent.keyDown(screen.getByTestId('chart-field-search'), { key: 'ArrowDown' });
    expect(onKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId('chart-settings-back'), { key: 'Escape' });
    expect(panel().getAttribute('data-page')).toBe('root');
    // A page consumed that Escape; on the root it reaches the host.
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId('chart-settings-row-x-sort'), { key: 'Escape' });
    expect(onKeyDown).toHaveBeenCalledWith('Escape');
  });
});

describe('ChartSettingsPanel Number chart title draft', () => {
  function Menu() {
    return (
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open settings</DropdownMenuTrigger>
        <DropdownMenuContent>
          <ChartSettingsPanel />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function typeTitle(title: string) {
    const input = screen.getByTestId('chart-number-title-input');

    act(() => input.focus());
    fireEvent.change(input, { target: { value: title } });
    return input;
  }

  beforeEach(() => {
    mockSettings = chartSettings({ chartType: ChartType.Number });
  });

  it('saves the draft when a click outside closes the menu', async () => {
    render(<Menu />);
    typeTitle('Revenue');
    // Radix listens for outside pointer downs from the next task on.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mockUpdate).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('chart-number-title-input')).toBeNull();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ titleText: 'Revenue' }, undefined);
  });

  it('discards the draft when Escape closes the menu', () => {
    const { unmount } = render(<Menu />);
    const input = typeTitle('Revenue');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('chart-number-title-input')).toBeNull();

    unmount();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('discards the draft when the view turns read-only with the menu open', () => {
    const { rerender, unmount } = render(<Menu />);

    typeTitle('Revenue');
    mockReadOnly = true;
    rerender(<Menu />);
    expect(screen.queryByTestId('chart-number-title-input')).toBeNull();

    unmount();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('writes once for a blur followed by an unmount', () => {
    const { unmount } = render(<Menu />);
    const input = typeTitle('Revenue');

    fireEvent.blur(input);
    unmount();

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ titleText: 'Revenue' }, undefined);
  });

  it('uses the auto caption as the placeholder', () => {
    render(<Menu />);
    expect(screen.getByTestId('chart-number-title-input').getAttribute('placeholder')).toBe('Count all');
  });
});

describe('ChartSettingsPanel Y types', () => {
  it('lists every property a chart can aggregate, Count all first', () => {
    render(<ChartSettingsPanel />);
    fireEvent.click(screen.getByTestId('chart-settings-row-y-what'));
    expect(screen.getAllByRole('menuitemradio').map((item) => item.getAttribute('data-testid'))).toEqual([
      'chart-field-none',
      'chart-field-name',
      'chart-field-status',
      'chart-field-estimate',
      'chart-field-due',
      'chart-field-urgent',
    ]);
    expect(PANEL_PROPERTIES.find((property) => property.type === FieldType.Formula)).toBeTruthy();
  });
});
