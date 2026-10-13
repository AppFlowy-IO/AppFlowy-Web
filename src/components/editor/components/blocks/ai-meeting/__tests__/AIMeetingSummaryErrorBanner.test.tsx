import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import translations from '@/@types/translations/en.json';
import { getSubscriptionLink } from '@/application/services/domains/billing';
import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { notify } from '@/components/_shared/notify';

import { AIMeetingSummaryErrorBanner } from '../AIMeetingSummaryErrorBanner';

let mockIsHosted = true;
const checkoutUrl = 'https://checkout.stripe.com/c/pay/test-pro-checkout';
const props = {
  message: 'This workspace has hit the free limit for AI responses.',
  errorCode: 1033,
  workspaceId: 'workspace',
  readOnly: false,
  onRetry: jest.fn(),
  onDismiss: jest.fn(),
  dismissLabel: 'Dismiss summary error',
};
const mockT = (key: string) => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)?.[part], translations);

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@/components/app/hooks/useServerInfo', () => ({ useIsOfficialHosted: () => mockIsHosted }));
jest.mock('@/application/services/domains/billing', () => ({ getSubscriptionLink: jest.fn() }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockIsHosted = true;
  jest.mocked(getSubscriptionLink).mockReset();
  jest.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe('AI response quota upgrade action', () => {
  it('offers Upgrade instead of Retry without loading billing data until clicked', () => {
    render(<AIMeetingSummaryErrorBanner {...props} />);
    expect(screen.getByRole('alert').textContent).toContain('Click to Upgrade.');
    expect(screen.getByRole('button', { name: 'Upgrade' }).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(getSubscriptionLink).not.toHaveBeenCalled();
  });

  it('opens the returned Stripe Pro checkout for this workspace and prevents duplicate requests while pending', async () => {
    let finish!: (link: string) => void;

    jest.mocked(getSubscriptionLink).mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }));
    render(<AIMeetingSummaryErrorBanner {...props} />);
    const upgrade = screen.getByRole('button', { name: 'Upgrade' });

    fireEvent.click(upgrade);
    fireEvent.click(upgrade);
    expect(upgrade.disabled).toBe(true);
    expect(upgrade.getAttribute('aria-busy')).toBe('true');
    expect(getSubscriptionLink).toHaveBeenCalledTimes(1);
    expect(getSubscriptionLink).toHaveBeenCalledWith('workspace', SubscriptionPlan.Pro, SubscriptionInterval.Month);
    expect(window.open).not.toHaveBeenCalled();
    await act(async () => { finish(checkoutUrl); });
    expect(window.open).toHaveBeenCalledWith(checkoutUrl, '_current');
    expect(props.onRetry).not.toHaveBeenCalled();
  });

  it('preserves the quota banner and lets checkout be retried after a billing error', async () => {
    jest.mocked(getSubscriptionLink).mockRejectedValueOnce({ code: 500, message: 'Checkout is temporarily unavailable.' }).mockResolvedValueOnce(checkoutUrl);
    render(<AIMeetingSummaryErrorBanner {...props} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Upgrade' })); });
    expect(notify.error).toHaveBeenCalledWith('Checkout is temporarily unavailable.');
    expect(screen.getByRole('alert').textContent).toContain(props.message);
    expect(screen.getByRole('button', { name: 'Upgrade' }).disabled).toBe(false);
    expect(window.open).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Upgrade' })); });
    expect(getSubscriptionLink).toHaveBeenCalledTimes(2);
    expect(window.open).toHaveBeenCalledWith(checkoutUrl, '_current');
  });

  it.each([
    ['workspace changes', { workspaceId: 'another-workspace' }],
    ['page becomes read-only', { readOnly: true }],
    ['quota error is replaced', { errorCode: 500 }],
  ])('ignores a late checkout response when the %s', async (_description, changes) => {
    let finish!: (link: string) => void;

    jest.mocked(getSubscriptionLink).mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }));
    const { rerender } = render(<AIMeetingSummaryErrorBanner {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }));
    rerender(<AIMeetingSummaryErrorBanner {...props} {...changes} />);
    await act(async () => { finish(checkoutUrl); });
    expect(window.open).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('ignores checkout responses after dismissal unmounts the banner', async () => {
    let finish!: (link: string) => void;

    jest.mocked(getSubscriptionLink).mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }));
    const { unmount } = render(<AIMeetingSummaryErrorBanner {...props} onDismiss={() => { unmount(); }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss summary error' }));
    await act(async () => { finish(checkoutUrl); });
    expect(window.open).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('ignores a checkout error after leaving the page', async () => {
    let fail!: (error: Error) => void;

    jest.mocked(getSubscriptionLink).mockReturnValueOnce(new Promise<string>((_resolve, reject) => { fail = reject; }));
    const { unmount } = render(<AIMeetingSummaryErrorBanner {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }));
    unmount();
    await act(async () => { fail(new Error('Late billing failure')); });
    expect(notify.error).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('invalidates pending checkout when the server is no longer officially hosted', async () => {
    let finish!: (link: string) => void;

    jest.mocked(getSubscriptionLink).mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }));
    const { rerender } = render(<AIMeetingSummaryErrorBanner {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }));
    mockIsHosted = false;
    rerender(<AIMeetingSummaryErrorBanner {...props} />);
    await act(async () => { finish(checkoutUrl); });
    expect(window.open).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it.each([
    ['read-only pages', { readOnly: true }],
    ['missing workspaces', { workspaceId: undefined }],
  ])('hides the quota action on %s', (_description, changes) => {
    render(<AIMeetingSummaryErrorBanner {...props} {...changes} />);
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(getSubscriptionLink).not.toHaveBeenCalled();
  });

  it('keeps Retry for a network error', () => {
    render(<AIMeetingSummaryErrorBanner {...props} errorCode={undefined} message='Network unavailable.' />);
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    expect(getSubscriptionLink).not.toHaveBeenCalled();
  });
});
