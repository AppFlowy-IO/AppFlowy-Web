import { act, fireEvent, render, screen } from '@testing-library/react';

import { DEFAULT_CHART_EXTENDED_SETTINGS } from '@/application/database-yjs/chart-extended-settings';
import {
  ChartAggregationType,
  ChartLayoutSettings as ChartLayoutSettingsData,
  ChartType,
} from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import ChartLayoutSettings from '@/components/database/components/settings/ChartLayoutSettings';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const mockUpdate = jest.fn();
let mockReadOnly = false;
let mockProperties: Array<{ id: string; type: FieldType }> = [];
const mockSettings: ChartLayoutSettingsData = {
  chartType: ChartType.Number,
  xFieldId: '',
  showEmptyValues: true,
  aggregationType: ChartAggregationType.Count,
  cumulative: false,
  dateCondition: DateGroupCondition.Month,
  numberFormat: 'auto',
  titleText: '',
  extended: DEFAULT_CHART_EXTENDED_SETTINGS,
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
  }),
}));

jest.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}));

jest.mock('@/application/database-yjs', () => ({
  useChartLayoutSetting: () => mockSettings,
  usePropertiesSelector: () => ({ properties: mockProperties }),
  useReadOnly: () => mockReadOnly,
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateChartSetting: () => mockUpdate,
}));

jest.mock('@/application/services/domains', () => ({
  BillingService: { getWorkspaceSubscriptions: jest.fn() },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useUserWorkspaceInfo: () => undefined,
}));

jest.mock('@/components/app/hooks/useServerInfo', () => ({
  useIsOfficialHosted: () => false,
}));

jest.mock('@/components/app/hooks/useSubscriptionPlan', () => ({
  useSubscriptionPlan: () => ({ isPro: true }),
}));

jest.mock('@/components/database/components/field', () => ({
  FieldDisplay: () => null,
}));

function ChartSettingsMenu() {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>Open settings</DropdownMenuTrigger>
      <DropdownMenuContent>
        <ChartLayoutSettings />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function typeTitle(title: string) {
  const trigger = screen.getByRole('menuitem', { name: 'Chart settings' });

  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  const input = await screen.findByTestId('chart-number-title-input');

  act(() => input.focus());
  fireEvent.change(input, { target: { value: title } });
  return input;
}

describe('ChartLayoutSettings Number chart title', () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockReadOnly = false;
  });

  it('saves the draft when a click outside closes the menu', async () => {
    render(<ChartSettingsMenu />);

    await typeTitle('Revenue');
    // Radix listens for outside pointer downs from the next task on.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mockUpdate).not.toHaveBeenCalled();

    // The menu closes on pointerdown, before focus could leave the input.
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('chart-number-title-input')).toBeNull();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ titleText: 'Revenue' });
  });

  it('discards the draft when Escape closes the menu', async () => {
    const { unmount } = render(<ChartSettingsMenu />);
    const input = await typeTitle('Revenue');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('chart-number-title-input')).toBeNull();

    unmount();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('discards the draft when the view turns read-only with the menu open', async () => {
    const { rerender, unmount } = render(<ChartSettingsMenu />);

    await typeTitle('Revenue');

    // A permission downgrade arriving live hides the chart settings.
    mockReadOnly = true;
    rerender(<ChartSettingsMenu />);
    expect(screen.queryByTestId('chart-number-title-input')).toBeNull();

    unmount();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('writes once for a blur followed by an unmount', async () => {
    const { unmount } = render(<ChartSettingsMenu />);
    const input = await typeTitle('Revenue');

    // The stored title has not come back yet when the menu unmounts.
    fireEvent.blur(input);
    unmount();

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ titleText: 'Revenue' });
  });
});

describe('ChartLayoutSettings Style rows', () => {
  function openChartSettings() {
    const trigger = screen.getByRole('menuitem', { name: 'Chart settings' });

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  }

  async function openRow(testId: string) {
    const row = await screen.findByTestId(testId);

    act(() => row.focus());
    fireEvent.keyDown(row, { key: 'ArrowRight' });
  }

  beforeEach(() => {
    mockUpdate.mockReset();
    mockReadOnly = false;
    mockSettings.chartType = ChartType.Bar;
    mockSettings.extended = DEFAULT_CHART_EXTENDED_SETTINGS;
  });

  afterAll(() => {
    mockSettings.chartType = ChartType.Number;
    mockSettings.extended = DEFAULT_CHART_EXTENDED_SETTINGS;
  });

  it('writes only the color theme that is picked', async () => {
    render(<ChartSettingsMenu />);
    openChartSettings();
    await openRow('chart-style-color');

    const options = await screen.findAllByTestId(/^chart-style-color-option-/);

    expect(options.map((option) => option.getAttribute('data-testid')?.replace('chart-style-color-option-', ''))).toEqual([
      'auto',
      'colorful',
      'colorless',
      'blue',
      'yellow',
      'green',
      'purple',
      'teal',
      'orange',
      'pink',
      'red',
    ]);
    fireEvent.click(screen.getByTestId('chart-style-color-option-blue'));
    expect(mockUpdate).toHaveBeenCalledWith({}, { colorTheme: 'blue' });
  });

  it('turns the data labels off', async () => {
    render(<ChartSettingsMenu />);
    openChartSettings();
    fireEvent.click(await screen.findByTestId('chart-style-data-labels'));
    expect(mockUpdate).toHaveBeenCalledWith({}, { showDataLabels: false });
  });

  it('hides the legend', async () => {
    render(<ChartSettingsMenu />);
    openChartSettings();
    await openRow('chart-style-legend');
    fireEvent.click(await screen.findByTestId('chart-style-legend-option-off'));
    expect(mockUpdate).toHaveBeenCalledWith({}, { legendPosition: 'off' });
  });

  it('fixes two decimal places, and Auto resets them with null', async () => {
    mockSettings.extended = { ...DEFAULT_CHART_EXTENDED_SETTINGS, decimalPlaces: 3 };
    render(<ChartSettingsMenu />);
    openChartSettings();
    await openRow('chart-style-decimal-places');
    expect((await screen.findByTestId('chart-style-decimal-places-option-2')).textContent).toBe('1.00');
    fireEvent.click(screen.getByTestId('chart-style-decimal-places-option-2'));
    expect(mockUpdate).toHaveBeenLastCalledWith({}, { decimalPlaces: 2 });
    fireEvent.click(screen.getByTestId('chart-style-decimal-places-option-auto'));
    expect(mockUpdate).toHaveBeenLastCalledWith({}, { decimalPlaces: null });
  });

  it('offers only Decimal places on a Number chart', async () => {
    mockSettings.chartType = ChartType.Number;
    render(<ChartSettingsMenu />);
    openChartSettings();
    expect(await screen.findByTestId('chart-style-decimal-places')).toBeTruthy();
    expect(screen.queryByTestId('chart-style-color')).toBeNull();
    expect(screen.queryByTestId('chart-style-legend')).toBeNull();
    expect(screen.queryByTestId('chart-style-data-labels')).toBeNull();
  });
});

describe('ChartLayoutSettings aggregation and Y field', () => {
  const NUMBER_FIELDS = [
    { id: 'amount', type: FieldType.Number },
    { id: 'done', type: FieldType.Checkbox },
    { id: 'due', type: FieldType.DateTime },
  ];
  // Not a Y field: a chart cannot aggregate text.
  const TEXT_FIELD = { id: 'name', type: FieldType.RichText };
  const AGGREGATIONS = [
    ChartAggregationType.Count,
    ChartAggregationType.CountValues,
    ChartAggregationType.Sum,
    ChartAggregationType.Average,
    ChartAggregationType.Min,
    ChartAggregationType.Max,
    ChartAggregationType.Median,
  ];

  function open() {
    render(<ChartSettingsMenu />);
    const trigger = screen.getByRole('menuitem', { name: 'Chart settings' });

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  }

  /** The menu items between the label `from` and the next label or separator. */
  function sectionItems(from: string) {
    const label = screen.getByText(from);
    const items: HTMLElement[] = [];

    for (let node = label.nextElementSibling; node; node = node.nextElementSibling) {
      if (node.getAttribute('role') !== 'menuitem') break;
      items.push(node as HTMLElement);
    }

    return items;
  }

  beforeEach(() => {
    mockUpdate.mockReset();
    mockReadOnly = false;
    mockProperties = [...NUMBER_FIELDS, TEXT_FIELD];
    mockSettings.chartType = ChartType.Number;
    mockSettings.aggregationType = ChartAggregationType.Count;
    mockSettings.yFieldId = undefined;
  });

  afterAll(() => {
    mockProperties = [];
    mockSettings.chartType = ChartType.Number;
    mockSettings.aggregationType = ChartAggregationType.Count;
    mockSettings.yFieldId = undefined;
  });

  it('lists every aggregation for the Number chart, with Count as "Count all"', async () => {
    open();
    await screen.findByText('Calculate');

    const items = sectionItems('Calculate');

    expect(items.map((item) => item.getAttribute('data-testid'))).toEqual(
      AGGREGATIONS.map((type) => `chart-number-aggregation-${type}`)
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'Count all',
      'Count values',
      'Sum',
      'Average',
      'Min',
      'Max',
      'Median',
    ]);
    // A count needs no property.
    expect(screen.queryByText('Property')).toBeNull();
  });

  it('lists the same aggregations for an axis chart, with Count as "Count" and no Number test ids', async () => {
    mockSettings.chartType = ChartType.Bar;
    open();
    await screen.findByText('Aggregation');

    const items = sectionItems('Aggregation');

    expect(items.map((item) => item.textContent)).toEqual([
      'Count',
      'Count values',
      'Sum',
      'Average',
      'Min',
      'Max',
      'Median',
    ]);
    expect(items.every((item) => item.getAttribute('data-testid') === null)).toBe(true);
    expect(screen.queryByText('Y-Axis')).toBeNull();
  });

  it.each([ChartType.Number, ChartType.Bar])(
    'picks the first Y field with a value aggregation and clears it with Count (chart type %p)',
    async (chartType) => {
      mockSettings.chartType = chartType;
      open();
      fireEvent.click(await screen.findByText('Sum'));
      expect(mockUpdate).toHaveBeenLastCalledWith({ aggregationType: ChartAggregationType.Sum, yFieldId: 'amount' });

      fireEvent.click(screen.getByText(chartType === ChartType.Number ? 'Count all' : 'Count'));
      expect(mockUpdate).toHaveBeenLastCalledWith({ aggregationType: ChartAggregationType.Count, yFieldId: '' });
    }
  );

  it('keeps the chosen Y field when the aggregation changes', async () => {
    mockSettings.aggregationType = ChartAggregationType.Sum;
    mockSettings.yFieldId = 'done';
    open();
    fireEvent.click(await screen.findByText('Average'));
    expect(mockUpdate).toHaveBeenLastCalledWith({ aggregationType: ChartAggregationType.Average });
  });

  it.each([
    [ChartType.Number, 'Property', 'chart-number-property-'],
    [ChartType.Bar, 'Y-Axis', null],
  ])('offers the number, checkbox and date fields as the Y field (chart type %p)', async (chartType, label, prefix) => {
    mockSettings.chartType = chartType;
    mockSettings.aggregationType = ChartAggregationType.Sum;
    mockSettings.yFieldId = 'amount';
    open();
    await screen.findByText(label);

    const items = sectionItems(label);

    expect(items).toHaveLength(NUMBER_FIELDS.length);
    expect(items.map((item) => item.getAttribute('data-testid'))).toEqual(
      NUMBER_FIELDS.map((field) => (prefix ? `${prefix}${field.id}` : null))
    );
    fireEvent.click(items[1]);
    expect(mockUpdate).toHaveBeenLastCalledWith({ yFieldId: 'done' });
  });

  it.each([
    [ChartType.Number, 'Property'],
    [ChartType.Bar, 'Y-Axis'],
  ])('says so when the database has no field to aggregate (chart type %p)', async (chartType, label) => {
    mockProperties = [TEXT_FIELD];
    mockSettings.chartType = chartType;
    mockSettings.aggregationType = ChartAggregationType.Sum;
    open();
    await screen.findByText(label);

    expect(sectionItems(label)).toHaveLength(0);
    expect(screen.getByText('No number fields available')).toBeTruthy();
  });
});
