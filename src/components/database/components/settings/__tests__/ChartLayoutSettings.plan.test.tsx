import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { ChartType } from '@/application/database-yjs/chart.type';
import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';

import ChartLayoutSettings from '../ChartLayoutSettings';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

const mockUpdate = jest.fn();
const mockGetSubscriptions = jest.fn();
let mockWorkspaceId = '';
let workspaceSequence = 0;
let mockReadOnly = false;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
jest.mock('@/application/database-yjs', () => ({
  useReadOnly: () => mockReadOnly,
  useChartLayoutSetting: () => ({ chartType: ChartType.Bar }),
  usePropertiesSelector: () => ({ properties: [] }),
}));
jest.mock('@/application/database-yjs/dispatch', () => ({ useUpdateChartSetting: () => mockUpdate }));
jest.mock('@/application/services/domains', () => ({
  BillingService: { getWorkspaceSubscriptions: (...args: unknown[]) => mockGetSubscriptions(...args) },
}));
jest.mock('@/components/app/app.hooks', () => ({
  useUserWorkspaceInfo: () => ({ selectedWorkspace: { id: mockWorkspaceId } }),
}));
jest.mock('@/utils/subscription', () => ({
  ...jest.requireActual('@/utils/subscription'),
  isAppFlowyHosted: () => true,
}));
jest.mock('@/components/database/components/field', () => ({ FieldDisplay: () => null }));
jest.mock('@/components/ui/dropdown-menu', () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;

  return {
    DropdownMenuSub: Container,
    DropdownMenuSubTrigger: Container,
    DropdownMenuPortal: Container,
    DropdownMenuSubContent: Container,
    DropdownMenuLabel: Container,
    DropdownMenuSeparator: () => null,
    DropdownMenuItemTick: () => null,
    DropdownMenuItem: ({ onSelect, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props} onClick={onSelect} />
    ),
  };
});

function Settings() {
  const { search } = useLocation();

  return (
    <>
      <ChartLayoutSettings />
      <output data-testid='search'>{search}</output>
    </>
  );
}

const paidSubscription = (plan: SubscriptionPlan) => ({
  plan,
  currency: 'USD',
  price_cents: 2000,
  recurring_interval: SubscriptionInterval.Month,
});

describe('chart workspace plans', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadOnly = false;
    mockWorkspaceId = `charts-${++workspaceSequence}`;
  });

  it.each([SubscriptionPlan.Free, SubscriptionPlan.AIMax])(
    '%s keeps Bar editable and prompts before premium chart mutations',
    async (plan) => {
      mockGetSubscriptions.mockResolvedValue(plan === SubscriptionPlan.Free ? [] : [paidSubscription(plan)]);
      render(
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      );
      await waitFor(() => expect(mockGetSubscriptions).toHaveBeenCalledWith(mockWorkspaceId));

      fireEvent.click(screen.getByRole('button', { name: 'Bar' }));
      expect(mockUpdate).toHaveBeenCalledWith({ chartType: ChartType.Bar });
      mockUpdate.mockClear();
      for (const name of ['Horizontal Bar', 'Line', 'Donut']) {
        fireEvent.click(screen.getByRole('button', { name: `${name} (Upgrade Required)` }));
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(screen.getByTestId('search').textContent).toBe('?action=change_plan');
      }
    }
  );

  it.each([SubscriptionPlan.Pro, SubscriptionPlan.Team])(
    '%s can select every chart type without an upgrade prompt',
    async (plan) => {
      mockGetSubscriptions.mockResolvedValue([paidSubscription(plan)]);
      render(
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      );
      await screen.findByRole('button', { name: 'Line' });

      for (const [name, chartType] of [
        ['Bar', ChartType.Bar],
        ['Horizontal Bar', ChartType.HorizontalBar],
        ['Line', ChartType.Line],
        ['Donut', ChartType.Donut],
      ] as const) {
        fireEvent.click(screen.getByRole('button', { name }));
        expect(mockUpdate).toHaveBeenLastCalledWith({ chartType });
      }

      expect(mockUpdate).toHaveBeenCalledTimes(4);
      expect(screen.getByTestId('search').textContent).toBe('');
    }
  );

  it('does not retain premium access after changing to a Free workspace', async () => {
    mockGetSubscriptions.mockResolvedValue([paidSubscription(SubscriptionPlan.Pro)]);
    const { rerender } = render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );

    await screen.findByRole('button', { name: 'Line' });
    mockWorkspaceId = 'free-workspace';
    mockGetSubscriptions.mockResolvedValue([]);
    rerender(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Line (Upgrade Required)' }));
    expect(mockUpdate).not.toHaveBeenCalled();
    await waitFor(() => expect(mockGetSubscriptions).toHaveBeenLastCalledWith('free-workspace'));
  });

  it('refreshes an open chart menu after upgrading and canceling the same workspace', async () => {
    jest.useFakeTimers();
    try {
      mockWorkspaceId = 'chart-plan-lifecycle';
      mockGetSubscriptions.mockResolvedValue([]);
      await act(async () => {
        render(
          <MemoryRouter>
            <Settings />
          </MemoryRouter>
        );
      });
      expect(screen.getByRole('button', { name: 'Line (Upgrade Required)' })).toBeTruthy();

      mockGetSubscriptions.mockResolvedValue([paidSubscription(SubscriptionPlan.Pro)]);
      await act(async () => {
        jest.advanceTimersByTime(60_001);
      });
      fireEvent.click(screen.getByRole('button', { name: 'Line' }));
      expect(mockUpdate).toHaveBeenCalledWith({ chartType: ChartType.Line });
      mockUpdate.mockClear();

      mockGetSubscriptions.mockResolvedValue([]);
      await act(async () => {
        jest.advanceTimersByTime(60_001);
      });
      fireEvent.click(screen.getByRole('button', { name: 'Line (Upgrade Required)' }));
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockGetSubscriptions).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not check billing or expose mutations for a published read-only chart', () => {
    mockReadOnly = true;
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );
    expect(mockGetSubscriptions).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
