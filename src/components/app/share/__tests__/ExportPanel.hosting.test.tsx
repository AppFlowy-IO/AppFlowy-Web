import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { updateServerInfo } from '@/utils/server-info';

import ExportPanel from '../ExportPanel';

const mockGetSubscriptions = jest.fn();
const mockGetSubscriptionLink = jest.fn();
const mockTranslate = (key: string) => key;
const serverUrl = 'https://workspace.example.com';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: () => 'https://workspace.example.com',
}));
jest.mock('@/application/services/domains', () => ({
  BillingService: { getSubscriptionLink: (...args: unknown[]) => mockGetSubscriptionLink(...args) },
}));
jest.mock('@/application/services/js-services/http/export-api', () => ({ getViewPdfBlob: jest.fn() }));
jest.mock('@/components/app/app.hooks', () => ({
  useAppView: () => ({ view_id: 'view-1' }),
  useCurrentWorkspaceId: () => 'workspace-1',
  useGetSubscriptions: () => mockGetSubscriptions,
}));
jest.mock('@/components/app/app-overlay/AppOverlayContext', () => ({
  useAppOverlayContext: () => ({ showBlockingLoader: jest.fn(), hideBlockingLoader: jest.fn() }),
}));

describe('ExportPanel hosting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSubscriptions.mockResolvedValue([]);
    mockGetSubscriptionLink.mockResolvedValue('https://checkout.example.com');
    updateServerInfo(serverUrl, { status: 'loading' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('withholds paid export options and upgrade guidance while hosting is unresolved', () => {
    render(<ExportPanel viewId='view-1' />);

    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('shareAction.exportPdfIncludeLinkedPagesPro')).toBeNull();
    expect(mockGetSubscriptions).not.toHaveBeenCalled();

    act(() => updateServerInfo(serverUrl, { status: 'unavailable' }));
    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('shareAction.exportPdfIncludeLinkedPagesPro')).toBeNull();
    expect(mockGetSubscriptionLink).not.toHaveBeenCalled();
  });

  it('enables self-hosted exports without subscriptions or checkout', () => {
    updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true, self_hosted: true } });
    render(<ExportPanel viewId='view-1' />);

    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('shareAction.exportPdfIncludeLinkedPagesPro')).toBeNull();
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('switch'));
    expect(mockGetSubscriptions).not.toHaveBeenCalled();
    expect(mockGetSubscriptionLink).not.toHaveBeenCalled();
  });

  it('keeps the upgrade action for a confirmed cloud Free plan', async () => {
    updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true, self_hosted: false } });
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);

    render(<ExportPanel viewId='view-1' />);
    await waitFor(() => expect(screen.getByText('shareAction.exportPdfIncludeLinkedPagesPro')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() =>
      expect(mockGetSubscriptionLink).toHaveBeenCalledWith(
        'workspace-1',
        SubscriptionPlan.Pro,
        SubscriptionInterval.Month
      )
    );
    expect(open).toHaveBeenCalledWith('https://checkout.example.com', '_blank');
  });
});
