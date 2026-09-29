import { act, fireEvent, render, screen } from '@testing-library/react';

import {
  ChartAggregationType,
  ChartLayoutSettings as ChartLayoutSettingsData,
  ChartType,
} from '@/application/database-yjs/chart.type';
import { DateGroupCondition } from '@/application/database-yjs/database.type';
import ChartLayoutSettings from '@/components/database/components/settings/ChartLayoutSettings';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const mockUpdate = jest.fn();
let mockReadOnly = false;
const mockSettings: ChartLayoutSettingsData = {
  chartType: ChartType.Number,
  xFieldId: '',
  showEmptyValues: true,
  aggregationType: ChartAggregationType.Count,
  cumulative: false,
  dateCondition: DateGroupCondition.Month,
  numberFormat: 'auto',
  titleText: '',
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
  usePropertiesSelector: () => ({ properties: [] }),
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
