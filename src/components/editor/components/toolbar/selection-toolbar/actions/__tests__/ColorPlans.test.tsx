import { act, fireEvent, render, screen } from '@testing-library/react';

import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';

import BgColor from '../BgColor';
import TextColor from '../TextColor';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

const mockGetSubscriptions = jest.fn();
const mockAddMark = jest.fn();
let mockWorkspaceId = '';
let workspaceSequence = 0;
let mockColorToApply = '#abcdef';
const savedColors = Array.from({ length: 10 }, (_, i) => `#00000${i}`);
const paid = (plan: SubscriptionPlan) => [
  { plan, currency: 'USD', price_cents: 2000, recurring_interval: SubscriptionInterval.Month },
];

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('slate-react', () => ({ useSlateStatic: () => ({}) }));
jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { getAllMarks: () => [], addMark: (...args: unknown[]) => mockAddMark(...args), removeMark: jest.fn() },
}));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ getSubscriptions: mockGetSubscriptions, workspaceId: mockWorkspaceId }),
}));
jest.mock('@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks', () => ({
  useSelectionToolbarContext: () => ({ visible: true, forceShow: jest.fn() }),
}));
jest.mock('@/utils/subscription', () => ({
  ...jest.requireActual('@/utils/subscription'),
  isAppFlowyHosted: () => true,
}));
jest.mock('@/utils/color', () => ({ renderColor: (color: string) => color }));
jest.mock('@/components/_shared/color-picker', () => ({
  ColorTile: ({ value, onClick }: { value: string; onClick: () => void }) => (
    <button data-testid='color-tile' aria-label={value || 'default-color'} onClick={onClick} />
  ),
}));
jest.mock('@/components/_shared/color-picker/CustomColorPicker', () => ({
  CustomColorPicker: ({ onApply }: { onApply: (color: string) => void }) => (
    <button onClick={() => onApply(mockColorToApply)}>Apply custom color</button>
  ),
}));
jest.mock('../ActionButton', () => ({
  __esModule: true,
  default: ({
    active: _active,
    tooltip: _tooltip,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; tooltip?: string }) => <button {...props} />,
}));
jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe.each([
  ['text', TextColor, 'text-color-button', 'text-color-15'],
  ['bg', BgColor, 'bg-color-button', 'bg-color-15'],
] as const)('%s color plan restrictions', (kind, Component, trigger, premiumColor) => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockWorkspaceId = `color-workspace-${++workspaceSequence}`;
    mockColorToApply = '#abcdef';
    localStorage.setItem(`custom-${kind}-colors`, JSON.stringify(savedColors));
  });

  it.each([
    [SubscriptionPlan.Free, 10, 4],
    [SubscriptionPlan.Pro, 15, 9],
    [SubscriptionPlan.Team, 15, 9],
  ] as const)('%s shows its palette and limits visible/saved custom colors', async (plan, paletteCount, customCount) => {
    mockGetSubscriptions.mockResolvedValue(plan === SubscriptionPlan.Free ? [] : paid(plan));
    await act(async () => {
      render(<Component focusEditor={jest.fn()} toggleDisableEditorFocus={jest.fn()} />);
    });
    fireEvent.click(screen.getByTestId(trigger));

    expect(screen.getAllByTestId('color-tile')).toHaveLength(paletteCount + customCount);
    expect(Boolean(screen.queryByRole('button', { name: premiumColor }))).toBe(plan !== SubscriptionPlan.Free);
    expect(screen.getByRole('button', { name: savedColors[customCount - 1] })).toBeTruthy();
    expect(screen.queryByRole('button', { name: savedColors[customCount] })).toBeNull();

    // Opening a downgraded palette must not destroy the user's other saved colors.
    expect(JSON.parse(localStorage.getItem(`custom-${kind}-colors`)!)).toEqual(savedColors);
    fireEvent.click(screen.getByRole('button', { name: 'colors.custom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom color' }));
    expect(JSON.parse(localStorage.getItem(`custom-${kind}-colors`)!)).toEqual([
      ...savedColors.slice(1, customCount),
      '#abcdef',
    ]);
    expect(screen.getAllByTestId('color-tile')).toHaveLength(paletteCount + customCount);
    expect(mockAddMark).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ value: '#abcdef' }));
  });

  it('restricts an already-open Pro palette after cancellation without erasing saved colors', async () => {
    jest.useFakeTimers();
    try {
      mockGetSubscriptions.mockResolvedValue(paid(SubscriptionPlan.Pro));
      await act(async () => {
        render(<Component focusEditor={jest.fn()} toggleDisableEditorFocus={jest.fn()} />);
      });
      fireEvent.click(screen.getByTestId(trigger));
      expect(screen.getAllByTestId('color-tile')).toHaveLength(24);

      mockGetSubscriptions.mockResolvedValue([]);
      await act(async () => {
        jest.advanceTimersByTime(60_001);
      });
      expect(screen.queryByRole('button', { name: premiumColor })).toBeNull();
      expect(screen.getAllByTestId('color-tile')).toHaveLength(14);
      expect(screen.queryByRole('button', { name: savedColors[4] })).toBeNull();
      expect(JSON.parse(localStorage.getItem(`custom-${kind}-colors`)!)).toEqual(savedColors);

      mockGetSubscriptions.mockResolvedValue(paid(SubscriptionPlan.Pro));
      await act(async () => {
        jest.advanceTimersByTime(60_001);
      });
      expect(screen.getByRole('button', { name: premiumColor })).toBeTruthy();
      expect(screen.getAllByTestId('color-tile')).toHaveLength(24);
      expect(mockGetSubscriptions).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reveals previously saved Pro colors when upgrading with a Free palette already open', async () => {
    jest.useFakeTimers();
    try {
      mockGetSubscriptions.mockResolvedValue([]);
      await act(async () => {
        render(<Component focusEditor={jest.fn()} toggleDisableEditorFocus={jest.fn()} />);
      });
      fireEvent.click(screen.getByTestId(trigger));
      expect(screen.getAllByTestId('color-tile')).toHaveLength(14);

      mockGetSubscriptions.mockResolvedValue(paid(SubscriptionPlan.Pro));
      await act(async () => {
        jest.advanceTimersByTime(60_001);
      });
      expect(screen.getAllByTestId('color-tile')).toHaveLength(24);
      expect(screen.getByRole('button', { name: savedColors[8] })).toBeTruthy();
      expect(JSON.parse(localStorage.getItem(`custom-${kind}-colors`)!)).toEqual(savedColors);
    } finally {
      jest.useRealTimers();
    }
  });

  it('can save a previously hidden Pro color into a Free custom-color slot', async () => {
    mockGetSubscriptions.mockResolvedValue([]);
    mockColorToApply = savedColors[8];
    await act(async () => {
      render(<Component focusEditor={jest.fn()} toggleDisableEditorFocus={jest.fn()} />);
    });
    fireEvent.click(screen.getByTestId(trigger));
    expect(screen.queryByRole('button', { name: mockColorToApply })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'colors.custom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom color' }));
    expect(screen.getByRole('button', { name: mockColorToApply })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(`custom-${kind}-colors`)!)).toEqual([
      ...savedColors.slice(1, 4),
      mockColorToApply,
    ]);
  });
});
