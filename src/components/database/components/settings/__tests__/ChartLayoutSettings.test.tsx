import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';

import { ChartAggregationType, ChartType } from '@/application/database-yjs/chart.type';
import type { ChartLayoutSettings as ChartLayoutSettingsValue } from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { Role } from '@/application/types';
import ChartLayoutSettings from '@/components/database/components/settings/ChartLayoutSettings';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type MockProperty = { id: string; name: string; type: FieldType; visible: boolean };
type MockPlan = { isPro: boolean; isLoading: boolean; hasError: boolean };

const mockUpdate = jest.fn();
const mockSetSearch = jest.fn();
const mockGetSubscriptions = jest.fn();
const mockUseWorkspaceSubscriptionPlan = jest.fn();
let mockReadOnly = false;
let mockIsHosted = false;
let mockPlan: MockPlan = { isPro: true, isLoading: false, hasError: false };
let mockRole: Role = Role.Owner;
let mockSetting: ChartLayoutSettingsValue | null = null;
let mockProperties: MockProperty[] = [];

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
  }),
}));

jest.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), mockSetSearch],
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

jest.mock('@/application/database-yjs', () => ({
  useChartLayoutSetting: () => mockSetting,
  // Like the real selector, `true` drops the hidden fields.
  usePropertiesSelector: (isFilterHidden?: boolean) => ({
    properties: isFilterHidden ? mockProperties.filter((property) => property.visible) : mockProperties,
    hiddenProperties: [],
  }),
  useReadOnly: () => mockReadOnly,
}));

jest.mock('@/application/database-yjs/context', () => ({
  useDatabaseContext: () => ({
    workspaceId: 'workspace-id',
    getSubscriptions: mockGetSubscriptions,
    readOnly: mockReadOnly,
  }),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateChartSetting: () => mockUpdate,
}));

jest.mock('@/components/app/app.hooks', () => ({
  useUserWorkspaceInfo: () => ({
    selectedWorkspace: { id: 'workspace-id', role: mockRole, owner: { uid: 1, name: 'Owner' } },
  }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => ({ uid: 2 }),
}));

jest.mock('@/components/app/hooks/useServerInfo', () => ({
  useIsOfficialHosted: () => mockIsHosted,
}));

jest.mock('@/components/app/hooks/useWorkspaceSubscriptionPlan', () => ({
  useWorkspaceSubscriptionPlan: (...args: unknown[]) => mockUseWorkspaceSubscriptionPlan(...args),
}));

const FIELDS: MockProperty[] = [
  { id: 'name', name: 'Name', type: FieldType.RichText, visible: true },
  { id: 'status', name: 'Status', type: FieldType.SingleSelect, visible: true },
  { id: 'amount', name: 'Amount', type: FieldType.Number, visible: true },
  { id: 'done', name: 'Done', type: FieldType.Checkbox, visible: true },
  // Hidden fields still feed the chart, like desktop's field controller list.
  { id: 'due', name: 'Due', type: FieldType.DateTime, visible: false },
  { id: 'created', name: 'Created', type: FieldType.CreatedTime, visible: true },
];

const BASE_SETTING: ChartLayoutSettingsValue = {
  chartType: ChartType.Bar,
  xFieldId: 'status',
  omitEmptyValues: false,
  aggregationType: ChartAggregationType.Count,
  yFieldId: undefined,
  dateCondition: DateGroupCondition.Month,
};

const PREMIUM_TYPES = [
  { slug: 'horizontal-bar', name: 'Horizontal Bar' },
  { slug: 'line', name: 'Line' },
  { slug: 'donut', name: 'Donut' },
];

function renderPanel() {
  return render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>Open settings</DropdownMenuTrigger>
      <DropdownMenuContent>
        <ChartLayoutSettings />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function hasTick(element: HTMLElement) {
  return element.querySelector('[data-slot="dropdown-menu-tick"]') !== null;
}

function testIdsOf(elements: Element[]) {
  return elements.map((element) => element.getAttribute('data-testid'));
}

async function openDateSubmenu(fieldId: string) {
  fireEvent.click(screen.getByTestId(`chart-x-axis-field-${fieldId}`));
  return screen.findByTestId('chart-date-condition-menu');
}

/** Crown, notched border and `data-locked` all come and go together. */
function expectCrowned(button: HTMLElement, crowned: boolean) {
  expect(button.getAttribute('data-locked')).toBe(crowned ? 'true' : null);
  expect(button.querySelector('[data-chart-type-pro-badge]') !== null).toBe(crowned);
  expect(button.querySelector('[data-chart-type-notched-border]') !== null).toBe(crowned);
  expect(button.className.includes('border-0')).toBe(crowned);
}

describe('ChartLayoutSettings', () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockSetSearch.mockReset();
    (toast.error as jest.Mock).mockReset();
    mockUseWorkspaceSubscriptionPlan.mockReset();
    mockUseWorkspaceSubscriptionPlan.mockImplementation(() => ({
      ...mockPlan,
      activeSubscriptionPlan: null,
      loadSubscription: jest.fn(),
    }));
    mockReadOnly = false;
    mockIsHosted = false;
    mockPlan = { isPro: true, isLoading: false, hasError: false };
    mockRole = Role.Owner;
    mockSetting = { ...BASE_SETTING };
    mockProperties = FIELDS;
  });

  it('renders the desktop sections inline in order', () => {
    renderPanel();

    const panel = screen.getByTestId('chart-layout-settings');
    const sections = Array.from(panel.children);

    // AFDivider(spacing: 8) spans the popover; the 6px spacer closes the panel.
    expect(sections[0].getAttribute('data-slot')).toBe('dropdown-menu-separator');
    expect(sections[sections.length - 1].hasAttribute('data-chart-settings-bottom-spacer')).toBe(true);
    expect(sections[sections.length - 1].className).toContain('h-1.5');

    const headers = Array.from(panel.querySelectorAll('[data-chart-settings-section-header]'));

    expect(headers.map((header) => header.textContent)).toEqual(['Chart type', 'X-Axis', 'Aggregation']);
    headers.forEach((header) => {
      expect(header.className).toContain('text-xs');
      expect(header.className).toContain('leading-[18px]');
      expect(header.className).toContain('font-medium');
      expect(header.className).toContain('text-text-tertiary');
      expect(header.className).toContain('py-1.5');
    });

    expect(testIdsOf(Array.from(panel.querySelectorAll('[data-chart-type-button]')))).toEqual([
      'chart-type-button-bar',
      'chart-type-button-horizontal-bar',
      'chart-type-button-line',
      'chart-type-button-donut',
    ]);
    // The hidden Due field is listed: the panel reads all fields, not the visible ones.
    expect(testIdsOf(Array.from(panel.querySelectorAll('[data-testid^="chart-x-axis-field-"]')))).toEqual([
      'chart-x-axis-field-status',
      'chart-x-axis-field-done',
      'chart-x-axis-field-due',
      'chart-x-axis-field-created',
    ]);
    expect(testIdsOf(Array.from(panel.querySelectorAll('[data-testid^="chart-aggregation-"]')))).toEqual([
      'chart-aggregation-count',
      'chart-aggregation-count-values',
      'chart-aggregation-sum',
      'chart-aggregation-average',
      'chart-aggregation-min',
      'chart-aggregation-max',
      'chart-aggregation-median',
    ]);
    expect(
      Array.from(panel.querySelectorAll('[data-testid^="chart-aggregation-"]')).map((row) => row.textContent)
    ).toEqual(['Count', 'Count values', 'Sum', 'Average', 'Min', 'Max', 'Median']);

    // The omit toggle sits right after the X-axis rows, before Aggregation.
    const omit = screen.getByTestId('chart-omit-zero-values');

    expect(
      screen.getByTestId('chart-x-axis-field-created').compareDocumentPosition(omit) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(omit.compareDocumentPosition(headers[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Count needs no Y-axis field.
    expect(screen.queryByText('Y-Axis')).toBeNull();
    expect(panel.querySelector('[data-testid^="chart-y-axis-field-"]')).toBeNull();

    expect(mockUseWorkspaceSubscriptionPlan).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      getSubscriptions: mockGetSubscriptions,
      enabled: true,
    });
  });

  it('marks the current chart type, X field and aggregation like desktop', () => {
    mockSetting = { ...BASE_SETTING, chartType: ChartType.Line, xFieldId: 'due' };
    renderPanel();

    const line = screen.getByRole('button', { name: 'Line' });
    const bar = screen.getByRole('button', { name: 'Bar' });

    expect(line.getAttribute('data-testid')).toBe('chart-type-button-line');
    expect(line.getAttribute('aria-pressed')).toBe('true');
    expect(line.className).toContain('border-border-info-thick');
    expect(line.className).toContain('bg-surface-layer-01-hover');
    expect(line.querySelector('svg')?.getAttribute('class')).toContain('text-icon-info-thick');
    expect(bar.getAttribute('aria-pressed')).toBe('false');
    expect(bar.className).toContain('border-border-primary');
    expect(bar.className).toContain('h-9');
    expect(bar.className).toContain('w-[46px]');
    expect(bar.querySelector('svg')?.getAttribute('class')).toContain('text-icon-primary');

    // A selected date field shows no tick (desktop), only the submenu chevron.
    const due = screen.getByTestId('chart-x-axis-field-due');

    expect(due.getAttribute('data-selected')).toBe('true');
    expect(due.getAttribute('aria-haspopup')).toBe('menu');
    expect(hasTick(due)).toBe(false);
    expect(hasTick(screen.getByTestId('chart-x-axis-field-status'))).toBe(false);
    expect(hasTick(screen.getByTestId('chart-aggregation-count'))).toBe(true);
    expect(hasTick(screen.getByTestId('chart-aggregation-sum'))).toBe(false);
  });

  it('exposes the selected field, aggregation and grouping rows as checked radio items', async () => {
    mockSetting = { ...BASE_SETTING, aggregationType: ChartAggregationType.Sum, yFieldId: 'done', xFieldId: 'due' };
    renderPanel();

    const sum = screen.getByRole('menuitemradio', { name: 'Sum' });

    expect(sum.getAttribute('data-testid')).toBe('chart-aggregation-sum');
    expect(sum.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Count' }).getAttribute('aria-checked')).toBe('false');
    expect(sum.querySelector('[data-slot="dropdown-menu-tick"]')?.getAttribute('aria-hidden')).toBe('true');

    const status = screen.getByTestId('chart-x-axis-field-status');
    const yDone = screen.getByTestId('chart-y-axis-field-done');

    expect(status.getAttribute('role')).toBe('menuitemradio');
    expect(status.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('chart-x-axis-field-done').getAttribute('aria-checked')).toBe('false');
    expect(yDone.getAttribute('role')).toBe('menuitemradio');
    expect(yDone.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('chart-y-axis-field-amount').getAttribute('aria-checked')).toBe('false');

    // The date row has to stay a sub trigger (menuitem), so it describes its
    // selection with visually hidden text instead of a tick.
    const due = screen.getByTestId('chart-x-axis-field-due');
    const cue = document.getElementById(due.getAttribute('aria-describedby') ?? '');

    expect(due.getAttribute('role')).toBe('menuitem');
    expect(due.getAttribute('aria-checked')).toBeNull();
    expect(due.getAttribute('aria-label')).toBe('Due');
    expect(cue?.textContent).toBe('Selected X-axis field');
    expect(cue?.className).toContain('sr-only');
    expect(due.contains(cue)).toBe(true);
    expect(screen.getByTestId('chart-x-axis-field-created').hasAttribute('aria-describedby')).toBe(false);

    const menu = await openDateSubmenu('due');
    const month = within(menu).getByRole('menuitemradio', { name: 'Month' });

    expect(month.getAttribute('data-testid')).toBe('chart-date-condition-month');
    expect(month.getAttribute('aria-checked')).toBe('true');
    expect(within(menu).getByRole('menuitemradio', { name: 'Week' }).getAttribute('aria-checked')).toBe('false');
  });

  it('ticks the first groupable field for a stale X field but keeps the stored one in writes', () => {
    mockSetting = { ...BASE_SETTING, xFieldId: 'deleted-field' };
    renderPanel();

    expect(hasTick(screen.getByTestId('chart-x-axis-field-status'))).toBe(true);

    fireEvent.click(screen.getByTestId('chart-omit-zero-values'));
    // Desktop `_saveSettings` writes a non-empty stored id back unchanged, so
    // the chart returns to that field once a collaborator restores it.
    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'deleted-field', omitEmptyValues: true });
  });

  it('persists the first groupable field when the view never stored one', () => {
    mockSetting = { ...BASE_SETTING, xFieldId: '' };
    renderPanel();

    expect(hasTick(screen.getByTestId('chart-x-axis-field-status'))).toBe(true);

    fireEvent.click(screen.getByTestId('chart-omit-zero-values'));
    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'status', omitEmptyValues: true });
  });

  it('shows the Y-axis fields with a tick for any aggregation but Count', () => {
    mockSetting = { ...BASE_SETTING, aggregationType: ChartAggregationType.Sum, yFieldId: 'done' };
    renderPanel();

    const panel = screen.getByTestId('chart-layout-settings');
    const headers = Array.from(panel.querySelectorAll('[data-chart-settings-section-header]'));

    expect(headers.map((header) => header.textContent)).toEqual(['Chart type', 'X-Axis', 'Aggregation', 'Y-Axis']);
    expect(testIdsOf(Array.from(panel.querySelectorAll('[data-testid^="chart-y-axis-field-"]')))).toEqual([
      'chart-y-axis-field-amount',
      'chart-y-axis-field-done',
      'chart-y-axis-field-due',
    ]);
    expect(hasTick(screen.getByTestId('chart-y-axis-field-done'))).toBe(true);
    expect(hasTick(screen.getByTestId('chart-y-axis-field-amount'))).toBe(false);
    expect(hasTick(screen.getByTestId('chart-aggregation-sum'))).toBe(true);
  });

  it('shows the desktop hints when no field can be grouped or aggregated', () => {
    mockProperties = [
      { id: 'name', name: 'Name', type: FieldType.RichText, visible: true },
      { id: 'url', name: 'Link', type: FieldType.URL, visible: true },
    ];
    mockSetting = { ...BASE_SETTING, xFieldId: '', aggregationType: ChartAggregationType.Average };
    renderPanel();

    const groupHint = screen.getByText('Add a Single Select, Multi Select, or Checkbox field to create a chart');

    expect(groupHint.className).toContain('text-xs');
    expect(groupHint.className).toContain('text-text-caption');
    expect(groupHint.className).toContain('p-2');
    expect(screen.getByText('No suitable fields for Y-axis')).toBeTruthy();
    // The omit toggle stays available, like the mobile panel.
    expect(screen.getByTestId('chart-omit-zero-values')).toBeTruthy();

    fireEvent.click(screen.getByTestId('chart-aggregation-sum'));
    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: '', aggregationType: ChartAggregationType.Sum });
  });

  it('auto-picks the first Y-axis field when an aggregation needs one and none is set', () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('chart-aggregation-sum'));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      xFieldId: 'status',
      aggregationType: ChartAggregationType.Sum,
      yFieldId: 'amount',
    });
    // Picking a row keeps the settings menu open.
    expect(screen.getByTestId('chart-layout-settings')).toBeTruthy();
  });

  it('keeps the current Y-axis field when switching between non-Count aggregations', () => {
    mockSetting = { ...BASE_SETTING, aggregationType: ChartAggregationType.Sum, yFieldId: 'done' };
    renderPanel();

    fireEvent.click(screen.getByTestId('chart-aggregation-median'));

    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'status', aggregationType: ChartAggregationType.Median });
  });

  it('clears the Y-axis field when Count is selected', () => {
    mockSetting = { ...BASE_SETTING, aggregationType: ChartAggregationType.Sum, yFieldId: 'amount' };
    renderPanel();

    fireEvent.click(screen.getByTestId('chart-aggregation-count'));

    expect(mockUpdate).toHaveBeenCalledWith({
      xFieldId: 'status',
      aggregationType: ChartAggregationType.Count,
      yFieldId: '',
    });
  });

  it('writes the selected X-axis and Y-axis fields', () => {
    mockSetting = { ...BASE_SETTING, aggregationType: ChartAggregationType.Max, yFieldId: 'amount' };
    renderPanel();

    fireEvent.click(screen.getByTestId('chart-x-axis-field-done'));
    expect(mockUpdate).toHaveBeenLastCalledWith({ xFieldId: 'done' });

    fireEvent.click(screen.getByTestId('chart-y-axis-field-due'));
    expect(mockUpdate).toHaveBeenLastCalledWith({ xFieldId: 'status', yFieldId: 'due' });
  });

  it('toggles omitEmptyValues from the Omit zero values row', () => {
    mockSetting = { ...BASE_SETTING, omitEmptyValues: true };
    renderPanel();

    const row = screen.getByRole('menuitemcheckbox', { name: 'Omit zero values' });
    const visualSwitch = within(row).getByRole('switch', { hidden: true });

    expect(row.getAttribute('data-testid')).toBe('chart-omit-zero-values');
    expect(row.getAttribute('aria-checked')).toBe('true');
    expect(visualSwitch.getAttribute('data-state')).toBe('checked');
    expect(visualSwitch.getAttribute('aria-hidden')).toBe('true');
    expect(visualSwitch.getAttribute('tabindex')).toBe('-1');

    fireEvent.click(row);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'status', omitEmptyValues: false });
  });

  it('selects a date field from its row and opens the date groupings', async () => {
    renderPanel();

    const menu = await openDateSubmenu('due');

    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'due' });
    expect(menu.className).toContain('w-[172px]');
    // The shared sub content is wider on its right side (`ml-2`), which made
    // Radix flip it from side to side forever; the override keeps one size.
    expect(menu.className).toContain('data-[side=right]:ml-0');
    expect(menu.className).not.toContain('data-[side=right]:ml-2');
    expect(testIdsOf(within(menu).getAllByRole('menuitemradio'))).toEqual([
      'chart-date-condition-relative',
      'chart-date-condition-day',
      'chart-date-condition-week',
      'chart-date-condition-month',
      'chart-date-condition-year',
    ]);
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent)
    ).toEqual(['Relative', 'Day', 'Week', 'Month', 'Year']);
    expect(hasTick(screen.getByTestId('chart-date-condition-month'))).toBe(true);
    expect(hasTick(screen.getByTestId('chart-date-condition-week'))).toBe(false);
  });

  it('writes the date grouping with its field and closes only the submenu', async () => {
    renderPanel();
    await openDateSubmenu('created');
    mockUpdate.mockReset();

    fireEvent.click(screen.getByTestId('chart-date-condition-week'));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'created', dateCondition: DateGroupCondition.Week });
    await waitFor(() => expect(screen.queryByTestId('chart-date-condition-menu')).toBeNull());
    expect(screen.getByTestId('chart-layout-settings')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId('chart-x-axis-field-created'));
  });

  it('selects a date field and opens its groupings with Enter', async () => {
    renderPanel();

    const due = screen.getByTestId('chart-x-axis-field-due');

    act(() => due.focus());
    fireEvent.keyDown(due, { key: 'Enter' });

    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'due' });
    expect(await screen.findByTestId('chart-date-condition-menu')).toBeTruthy();
  });

  it('selects a date field with Space unless the Space continues a typeahead search', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      renderPanel();

      const due = screen.getByTestId('chart-x-axis-field-due');

      act(() => due.focus());
      // No row starts with "x", so the key only starts Radix's one-second
      // typeahead window, in which a Space extends the search instead.
      fireEvent.keyDown(due, { key: 'x' });
      fireEvent.keyDown(due, { key: ' ' });

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(screen.queryByTestId('chart-date-condition-menu')).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      fireEvent.keyDown(due, { key: ' ' });

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'due' });
      expect(await screen.findByTestId('chart-date-condition-menu')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens the groupings with ArrowRight without selecting the field', async () => {
    renderPanel();

    const due = screen.getByTestId('chart-x-axis-field-due');

    act(() => due.focus());
    fireEvent.keyDown(due, { key: 'ArrowRight' });

    expect(await screen.findByTestId('chart-date-condition-menu')).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('closes the date submenu when another row takes over', async () => {
    renderPanel();
    await openDateSubmenu('due');

    // Radix focuses a row on hover; that focus closes the open submenu.
    act(() => screen.getByTestId('chart-aggregation-sum').focus());

    await waitFor(() => expect(screen.queryByTestId('chart-date-condition-menu')).toBeNull());
    expect(screen.getByTestId('chart-layout-settings')).toBeTruthy();
  });

  it('switches to an available chart type and keeps the menu open', () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('chart-type-button-donut'));

    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'status', chartType: ChartType.Donut });
    expect(screen.getByTestId('chart-layout-settings')).toBeTruthy();
  });

  it('activates chart types from the keyboard and moves between them with the arrow keys', () => {
    renderPanel();

    const bar = screen.getByTestId('chart-type-button-bar');

    act(() => bar.focus());
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByTestId('chart-type-button-horizontal-bar'));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByTestId('chart-type-button-donut'));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'status', chartType: ChartType.Donut });
  });

  it('shows the chart type name in a tooltip', async () => {
    renderPanel();

    act(() => screen.getByTestId('chart-type-button-horizontal-bar').focus());

    expect((await screen.findByRole('tooltip')).textContent).toBe('Horizontal Bar');
  });

  it('shows no crown to a Pro workspace on official hosting and switches at once', () => {
    mockIsHosted = true;
    renderPanel();

    PREMIUM_TYPES.forEach(({ slug, name }) => {
      const button = screen.getByTestId(`chart-type-button-${slug}`);

      expectCrowned(button, false);
      expect(button.getAttribute('aria-disabled')).toBeNull();
      expect(button.getAttribute('aria-label')).toBe(name);
    });

    fireEvent.click(screen.getByTestId('chart-type-button-line'));

    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'status', chartType: ChartType.Line });
    expect(mockSetSearch).not.toHaveBeenCalled();
  });

  it('badges locked premium types on official hosting and lets the owner open the upgrade prompt', async () => {
    mockIsHosted = true;
    mockPlan = { isPro: false, isLoading: false, hasError: false };
    renderPanel();

    const bar = screen.getByTestId('chart-type-button-bar');

    expectCrowned(bar, false);
    expect(screen.getByRole('button', { name: 'Bar' })).toBe(bar);

    PREMIUM_TYPES.forEach(({ slug, name }) => {
      const button = screen.getByTestId(`chart-type-button-${slug}`);

      expectCrowned(button, true);
      expect(button.getAttribute('aria-disabled')).toBeNull();
      // The notched outline leaves the badge corner free of a border line.
      expect(button.querySelector('[data-chart-type-notched-border] path')?.getAttribute('d')).toContain('H36M45.5 10');
      // Desktop's crown is visual only; the web keeps its spoken cue.
      expect(screen.getByRole('button', { name: `${name} (Upgrade Required)` })).toBe(button);
    });

    // The tooltip stays the plain type name, like desktop.
    act(() => screen.getByTestId('chart-type-button-line').focus());
    expect((await screen.findByRole('tooltip')).textContent).toBe('Line');

    fireEvent.click(screen.getByTestId('chart-type-button-line'));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(mockSetSearch).toHaveBeenCalledTimes(1);

    const updateSearch = mockSetSearch.mock.calls[0][0] as (prev: URLSearchParams) => URLSearchParams;

    expect(updateSearch(new URLSearchParams()).get('action')).toBe('change_plan');
    // The settings menu closes so the plan modal can take over.
    await waitFor(() => expect(screen.queryByTestId('chart-layout-settings')).toBeNull());
  });

  it('keeps the menu open and tells other members to ask the owner for a locked type', () => {
    mockIsHosted = true;
    mockPlan = { isPro: false, isLoading: false, hasError: false };
    mockRole = Role.Member;
    renderPanel();

    const line = screen.getByTestId('chart-type-button-line');

    expectCrowned(line, true);

    fireEvent.click(line);

    // Desktop `showWorkspaceUpgradePrompt`: non-owners get an error toast, no dialog.
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('billingLimits.workspaceProRequired');
    expect(mockSetSearch).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByTestId('chart-layout-settings')).toBeTruthy();
  });

  it('keeps a stored premium type selected while it is locked', () => {
    mockIsHosted = true;
    mockPlan = { isPro: false, isLoading: false, hasError: false };
    mockSetting = { ...BASE_SETTING, chartType: ChartType.Donut };
    renderPanel();

    const donut = screen.getByTestId('chart-type-button-donut');

    expect(donut.getAttribute('aria-pressed')).toBe('true');
    expect(donut.getAttribute('data-locked')).toBe('true');
    expect(donut.querySelector('[data-chart-type-notched-border]')?.getAttribute('class')).toContain(
      'text-border-info-thick'
    );
  });

  it.each([
    ['loading', { isPro: false, isLoading: true, hasError: false }],
    ['failed to load', { isPro: false, isLoading: false, hasError: true }],
  ])('shows no crown and ignores premium clicks while the plan is %s', (_state, plan) => {
    mockIsHosted = true;
    mockPlan = plan;
    renderPanel();

    PREMIUM_TYPES.forEach(({ slug, name }) => {
      const button = screen.getByTestId(`chart-type-button-${slug}`);

      // Not Free until billing says so: nothing flashes for a Pro workspace.
      expectCrowned(button, false);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      // Not a Radix-disabled item: it keeps its look and stays reachable.
      expect(button.hasAttribute('data-disabled')).toBe(false);
      expect(screen.getByRole('button', { name })).toBe(button);
    });
    expect(screen.getByTestId('chart-type-button-bar').getAttribute('aria-disabled')).toBeNull();

    fireEvent.click(screen.getByTestId('chart-type-button-line'));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetSearch).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByTestId('chart-layout-settings')).toBeTruthy();

    // Bar is free and still works.
    fireEvent.click(screen.getByTestId('chart-type-button-bar'));
    expect(mockUpdate).toHaveBeenCalledWith({ xFieldId: 'status', chartType: ChartType.Bar });
  });

  it('keeps premium types inert without a crown while the hosting mode is unknown', () => {
    mockIsHosted = false;
    mockPlan = { isPro: false, isLoading: true, hasError: false };
    renderPanel();

    const line = screen.getByTestId('chart-type-button-line');

    expectCrowned(line, false);
    expect(line.getAttribute('aria-disabled')).toBe('true');
    expect(line.getAttribute('aria-label')).toBe('Line');
    expect(screen.getByTestId('chart-type-button-bar').getAttribute('aria-disabled')).toBeNull();

    fireEvent.click(line);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetSearch).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByTestId('chart-layout-settings')).toBeTruthy();
  });

  it('renders nothing in read-only mode and skips the subscription fetch', () => {
    mockReadOnly = true;
    renderPanel();

    expect(screen.queryByTestId('chart-layout-settings')).toBeNull();
    expect(screen.queryByTestId('chart-type-button-bar')).toBeNull();
    expect(screen.queryByTestId('chart-omit-zero-values')).toBeNull();
    expect(mockUseWorkspaceSubscriptionPlan).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      getSubscriptions: mockGetSubscriptions,
      enabled: false,
    });
  });
});
