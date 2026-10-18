import { act, fireEvent, render, screen } from '@testing-library/react';
import { PropsWithChildren } from 'react';

import { Subscription, SubscriptionInterval, SubscriptionPlan } from '@/application/types';

import BgColor from '../BgColor';
import TextColor from '../TextColor';

const mockGetSubscriptions = jest.fn<Promise<Subscription[]>, []>();
const mockTranslate = (key: string) => key;
const mockEditor = {};
let mockWorkspaceId = '';
let workspaceSequence = 0;

jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ workspaceId: mockWorkspaceId, getSubscriptions: mockGetSubscriptions }),
}));
jest.mock('@/components/main/app.hooks', () => ({ useAuthenticatedUserIdOptional: () => 'color-controls-user' }));
jest.mock('@/components/app/hooks/useServerInfo', () => ({
  useServerHostingMode: () => 'cloud',
  useServerInfoState: () => ({ status: 'available' }),
}));
jest.mock('slate-react', () => ({ useSlateStatic: () => mockEditor }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { getAllMarks: () => [], addMark: jest.fn(), removeMark: jest.fn() },
}));
jest.mock('@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks', () => ({
  useSelectionToolbarContext: () => ({ visible: true, forceShow: jest.fn() }),
}));
jest.mock('@/components/_shared/color-picker', () => ({
  ColorTile: ({ 'aria-label': label }: { 'aria-label'?: string }) => <button aria-label={label} />,
}));
jest.mock('@/components/_shared/color-picker/CustomColorPicker', () => ({
  CustomColorPicker: ({ onApply }: { onApply: (color: string) => void }) => (
    <button onClick={() => onApply('#abcdef')}>Apply custom color</button>
  ),
}));
jest.mock('@/utils/color', () => ({ renderColor: (color: string) => color }));
jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: PropsWithChildren) => <>{children}</>,
  PopoverContent: ({ children }: PropsWithChildren) => <>{children}</>,
  PopoverTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
  TooltipTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
  TooltipContent: () => null,
}));
jest.mock('../ActionButton', () => ({
  __esModule: true,
  default: ({ 'data-testid': testId, onClick }: { 'data-testid'?: string; onClick: () => void }) => (
    <button data-testid={testId} onClick={onClick} />
  ),
}));

beforeEach(() => {
  mockWorkspaceId = `color-controls-workspace-${++workspaceSequence}`;
  mockGetSubscriptions.mockReset();
  localStorage.clear();
});

const proSubscription: Subscription = {
  currency: 'USD',
  plan: SubscriptionPlan.Pro,
  price_cents: 1000,
  recurring_interval: SubscriptionInterval.Month,
};

it('loads billing only on opening a color control and refreshes the saved Pro palette when it resolves', async () => {
  let resolve!: (subscriptions: Subscription[]) => void;

  mockGetSubscriptions.mockReturnValue(
    new Promise((resolvePromise) => {
      resolve = resolvePromise;
    })
  );
  const customColors = Array.from({ length: 9 }, (_, index) => `#00000${index}`);

  localStorage.setItem('custom-text-colors', JSON.stringify(customColors));
  const focusEditor = jest.fn();
  const toggleDisableEditorFocus = jest.fn();

  render(
    <>
      <TextColor focusEditor={focusEditor} toggleDisableEditorFocus={toggleDisableEditorFocus} />
      <BgColor focusEditor={focusEditor} toggleDisableEditorFocus={toggleDisableEditorFocus} />
    </>
  );
  expect(mockGetSubscriptions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('text-color-button'));
  expect(mockGetSubscriptions).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: customColors[0] })).toBeNull();
  await act(async () => resolve([proSubscription]));
  expect(screen.getByRole('button', { name: customColors[0] })).toBeTruthy();
  fireEvent.click(screen.getByTestId('bg-color-button'));
  expect(mockGetSubscriptions).toHaveBeenCalledTimes(1);
  localStorage.clear();
});

describe.each([
  { name: 'text', Component: TextColor, storageKey: 'custom-text-colors', button: 'text-color-button' },
  { name: 'background', Component: BgColor, storageKey: 'custom-bg-colors', button: 'bg-color-button' },
])('$name custom palette', ({ Component, storageKey, button }) => {
  it.each(['pending', 'unavailable'])('preserves saved Pro colors when adding while the plan is %s', async (status) => {
    let resolve!: (subscriptions: Subscription[]) => void;
    let reject!: (reason: Error) => void;

    mockGetSubscriptions.mockReturnValue(
      new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      })
    );
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const savedColors = Array.from({ length: 9 }, (_, index) => `#00000${index}`);

    localStorage.setItem(storageKey, JSON.stringify(savedColors));
    render(<Component focusEditor={jest.fn()} toggleDisableEditorFocus={jest.fn()} />);
    fireEvent.click(screen.getByTestId(button));
    if (status === 'unavailable') await act(async () => reject(new Error('Billing unavailable')));

    try {
      fireEvent.click(screen.getByRole('button', { name: 'editor.customColor' }));
      fireEvent.click(screen.getByRole('button', { name: 'Apply custom color' }));
      expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual([...savedColors.slice(1), '#abcdef']);
      expect(screen.getByRole('button', { name: '#abcdef' })).toBeTruthy();
      // The paid slots remain hidden until a plan has actually been confirmed.
      expect(screen.queryByRole('button', { name: savedColors[1] })).toBeNull();

      if (status === 'pending') {
        await act(async () => resolve([proSubscription]));
        expect(screen.getByRole('button', { name: savedColors[1] })).toBeTruthy();
        expect(screen.getByRole('button', { name: '#abcdef' })).toBeTruthy();
      }
    } finally {
      error.mockRestore();
    }
  });

  it('keeps the normal four-color limit after a Free plan is confirmed', async () => {
    mockGetSubscriptions.mockResolvedValue([]);
    const savedColors = Array.from({ length: 9 }, (_, index) => `#00000${index}`);

    localStorage.setItem(storageKey, JSON.stringify(savedColors));
    render(<Component focusEditor={jest.fn()} toggleDisableEditorFocus={jest.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId(button));
    });
    fireEvent.click(screen.getByRole('button', { name: 'editor.customColor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom color' }));
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual([...savedColors.slice(-3), '#abcdef']);
  });
});
