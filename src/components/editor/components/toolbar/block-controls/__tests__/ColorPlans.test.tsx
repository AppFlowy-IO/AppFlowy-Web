import { act, fireEvent, render, screen } from '@testing-library/react';

import { BlockType, SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { BlockNode } from '@/components/editor/editor.type';
import { ColorEnum } from '@/utils/color';

import Color from '../Color';

import type { ReactNode } from 'react';

const mockGetSubscriptions = jest.fn();
const mockSetBlockData = jest.fn();
let mockWorkspaceId = '';
let workspaceSequence = 0;
const subscriptions = (plan: SubscriptionPlan) => [
  { plan, currency: 'USD', price_cents: 2000, recurring_interval: SubscriptionInterval.Month },
];

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('slate-react', () => ({ useSlateStatic: () => ({}) }));
jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { setBlockData: (...args: unknown[]) => mockSetBlockData(...args) },
}));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ getSubscriptions: mockGetSubscriptions, workspaceId: mockWorkspaceId }),
}));
jest.mock('@/utils/subscription', () => ({
  ...jest.requireActual('@/utils/subscription'),
  isAppFlowyHosted: () => true,
}));
jest.mock('@/components/_shared/color-picker', () => ({
  ColorTile: ({ onClick }: { onClick: () => void }) => <button data-testid='color-tile' onClick={onClick} />,
  ColorTileIcon: () => null,
}));
jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
}));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const node = { blockId: 'block-id', type: BlockType.Paragraph, data: {} } as BlockNode;

describe('block background palette plans', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkspaceId = `block-color-${++workspaceSequence}`;
  });

  it.each([SubscriptionPlan.Free, SubscriptionPlan.Pro, SubscriptionPlan.Team])(
    '%s exposes the correct palette and applies an allowed color',
    async (plan) => {
      mockGetSubscriptions.mockResolvedValue(plan === SubscriptionPlan.Free ? [] : subscriptions(plan));
      const onSelectColor = jest.fn();

      await act(async () => {
        render(<Color node={node} onSelectColor={onSelectColor} />);
      });
      fireEvent.click(screen.getByRole('button', { name: 'document.plugins.optionAction.color' }));
      expect(screen.getAllByTestId('color-tile')).toHaveLength(plan === SubscriptionPlan.Free ? 10 : 15);
      expect(Boolean(screen.queryByText('colors.lavender'))).toBe(plan !== SubscriptionPlan.Free);
      fireEvent.click(screen.getByText('colors.mauve').querySelector('button')!);
      expect(mockSetBlockData).toHaveBeenCalledWith(expect.anything(), 'block-id', { bgColor: ColorEnum.Tint1 });
      expect(onSelectColor).toHaveBeenCalledTimes(1);
    }
  );

  it('refreshes an open block palette through an upgrade and cancellation', async () => {
    jest.useFakeTimers();
    try {
      mockGetSubscriptions.mockResolvedValue([]);
      await act(async () => {
        render(<Color node={node} onSelectColor={jest.fn()} />);
      });
      fireEvent.click(screen.getByRole('button', { name: 'document.plugins.optionAction.color' }));
      expect(screen.queryByText('colors.lavender')).toBeNull();

      mockGetSubscriptions.mockResolvedValue(subscriptions(SubscriptionPlan.Pro));
      await act(async () => {
        jest.advanceTimersByTime(60_001);
      });
      expect(screen.getByText('colors.lavender')).toBeTruthy();

      mockGetSubscriptions.mockResolvedValue([]);
      await act(async () => {
        jest.advanceTimersByTime(60_001);
      });
      expect(screen.queryByText('colors.lavender')).toBeNull();
      expect(mockSetBlockData).not.toHaveBeenCalled();
      expect(mockGetSubscriptions).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
