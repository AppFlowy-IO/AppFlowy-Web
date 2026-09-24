import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { downloadBlob } from '@/utils/download';

import ExportPanel from '../ExportPanel';

import type { ButtonHTMLAttributes } from 'react';

const mockPost = jest.fn();
const mockCheckout = jest.fn();
const mockGetSubscriptions = jest.fn();
const mockHideLoader = jest.fn();
let mockWorkspaceId = '';
let workspaceSequence = 0;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({
  BillingService: { getSubscriptionLink: (...args: unknown[]) => mockCheckout(...args) },
}));
jest.mock('@/application/services/js-services/http/core', () => ({
  ...jest.requireActual('@/application/services/js-services/http/core'),
  getAxios: () => ({ post: (...args: unknown[]) => mockPost(...args) }),
}));
jest.mock('@/components/app/app.hooks', () => ({
  useAppView: () => ({ view_id: 'parent-page' }),
  useCurrentWorkspaceId: () => mockWorkspaceId,
  useGetSubscriptions: () => mockGetSubscriptions,
}));
jest.mock('@/components/app/app-overlay/AppOverlayContext', () => ({
  useAppOverlayContext: () => ({ showBlockingLoader: jest.fn(), hideBlockingLoader: mockHideLoader }),
}));
jest.mock('@/utils/subscription', () => ({
  ...jest.requireActual('@/utils/subscription'),
  isAppFlowyHosted: () => true,
}));
jest.mock('@/utils/download', () => ({ downloadBlob: jest.fn() }));
jest.mock('@/components/ui/button', () => ({
  Button: ({ loading: _loading, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
    <button {...props} />
  ),
}));

const subscription = (plan: SubscriptionPlan) => [
  { plan, currency: 'USD', price_cents: 2000, recurring_interval: SubscriptionInterval.Month },
];
const pdf = new Blob(['%PDF-1.4\nserver-rendered-content\n%%EOF'], { type: 'application/pdf' });

describe('PDF export plan request contract', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockWorkspaceId = `workspace-pdf-${++workspaceSequence}`;
    mockPost.mockResolvedValue({ data: pdf, headers: { 'content-disposition': 'attachment; filename="Parent.pdf"' } });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([SubscriptionPlan.Free, SubscriptionPlan.Pro, SubscriptionPlan.Team])(
    '%s sends exact child/database options and downloads the unchanged server artifact',
    async (plan) => {
      const paid = plan !== SubscriptionPlan.Free;

      mockGetSubscriptions.mockResolvedValue(paid ? subscription(plan) : []);
      await act(async () => {
        render(<ExportPanel viewId='parent-page' />);
      });
      expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe(String(paid));
      fireEvent.click(screen.getByTestId('export-pdf-button'));

      await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(pdf, 'Parent.pdf'));
      expect(mockPost).toHaveBeenCalledWith(
        `/api/export/view/${mockWorkspaceId}/parent-page/pdf`,
        undefined,
        expect.objectContaining({
          params: { include_nested: paid, include_database: paid, include_images: true, max_depth: 2 },
          responseType: 'blob',
        })
      );
      expect(downloadBlob).toHaveBeenCalledTimes(1);
      expect(mockHideLoader).toHaveBeenCalledTimes(1);
      expect(toast.error).not.toHaveBeenCalled();
    }
  );

  it('keeps a canceled Free upgrade single-page, then permits nested export after upgrading', async () => {
    mockGetSubscriptions.mockResolvedValue([]);
    mockCheckout.mockResolvedValue('https://checkout.example/pro');
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);

    render(<ExportPanel viewId='parent-page' />);

    await act(async () => undefined);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://checkout.example/pro', '_blank'));
    expect(mockCheckout).toHaveBeenCalledWith(mockWorkspaceId, SubscriptionPlan.Pro, SubscriptionInterval.Month);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(mockPost).not.toHaveBeenCalled();

    mockGetSubscriptions.mockResolvedValue(subscription(SubscriptionPlan.Pro));
    await act(async () => {
      jest.advanceTimersByTime(60_001);
    });
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(screen.getByTestId('export-pdf-button'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    expect(mockPost.mock.calls[0][2].params.include_nested).toBe(true);
    open.mockRestore();
  });

  it('honors Pro opt-out and clears an enabled nested toggle after cancellation', async () => {
    mockGetSubscriptions.mockResolvedValue(subscription(SubscriptionPlan.Pro));
    render(<ExportPanel viewId='parent-page' />);

    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByTestId('export-pdf-button'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(mockPost.mock.calls[0][2].params).toMatchObject({ include_nested: false, include_database: true });
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');

    mockGetSubscriptions.mockResolvedValue([]);
    await act(async () => {
      jest.advanceTimersByTime(60_001);
    });
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(screen.getByTestId('export-pdf-button'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(2));
    expect(mockPost.mock.calls[1][2].params).toMatchObject({ include_nested: false, include_database: false });
  });

  it('shows a stale-plan rejection without downloading JSON as a PDF, and allows retry', async () => {
    mockGetSubscriptions.mockResolvedValue(subscription(SubscriptionPlan.Pro));
    const denied = new Blob(['{}'], { type: 'application/json' });

    denied.text = async () => JSON.stringify({ code: 1076, message: 'Nested PDF export requires a Pro workspace.' });
    mockPost.mockResolvedValueOnce({ data: denied, headers: { 'content-type': 'application/json' } });
    await act(async () => {
      render(<ExportPanel viewId='parent-page' />);
    });
    fireEvent.click(screen.getByTestId('export-pdf-button'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nested PDF export requires a Pro workspace.'));
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(mockHideLoader).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('export-pdf-button'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(pdf, 'Parent.pdf'));
    expect(mockHideLoader).toHaveBeenCalledTimes(2);
  });
});
