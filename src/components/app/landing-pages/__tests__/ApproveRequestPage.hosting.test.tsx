import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { ERROR_CODE } from '@/application/constants';
import { RequestAccessInfoStatus, SubscriptionPlan } from '@/application/types';

import ApproveRequestPage from '../ApproveRequestPage';

import type { ReactNode } from 'react';

const mockApproveRequestAccess = jest.fn();
const mockGetRequestAccessInfo = jest.fn();
const mockGetActiveSubscription = jest.fn();
const mockUseServerInfo = jest.fn();
const mockToastError = jest.fn();
const mockTranslate = (key: string) => key;
let mockServerInfo: { status: 'loading' | 'available'; info?: { self_hosted: boolean } } = { status: 'loading' };

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
  Trans: () => null,
}));
jest.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args), success: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({
  AccessService: {
    getRequestAccessInfo: (...args: unknown[]) => mockGetRequestAccessInfo(...args),
    approveRequestAccess: (...args: unknown[]) => mockApproveRequestAccess(...args),
  },
  BillingService: {
    getActiveSubscription: (...args: unknown[]) => mockGetActiveSubscription(...args),
    getSubscriptionLink: jest.fn(),
  },
}));
jest.mock('@/components/main/app.hooks', () => ({
  defaultConfig: { baseURL: 'https://workspace.example.com' },
  useIsAuthenticatedOptional: () => true,
}));
jest.mock('@/components/app/hooks/useServerInfo', () => ({
  useServerInfo: (...args: unknown[]) => {
    mockUseServerInfo(...args);
    return mockServerInfo;
  },
  useIsOfficialHosted: () => mockServerInfo.status === 'available' && mockServerInfo.info?.self_hosted === false,
}));
jest.mock('@/components/_shared/landing-page/LandingPage', () => ({
  __esModule: true,
  default: () => <div data-testid='landing-page' />,
}));
jest.mock('@/components/_shared/landing-page/ErrorPage', () => ({
  ErrorPage: ({ error }: { error?: { message?: string } }) => <div>{error?.message}</div>,
}));
jest.mock('@/components/_shared/landing-page/NotInvitationAccount', () => ({
  NotInvitationAccount: () => null,
}));
jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
}));

function Page() {
  return (
    <MemoryRouter initialEntries={['/approve-request?request_id=request-1']}>
      <ApproveRequestPage />
    </MemoryRouter>
  );
}

describe('ApproveRequestPage hosting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServerInfo = { status: 'loading' };
    mockGetRequestAccessInfo.mockResolvedValue({
      status: RequestAccessInfoStatus.Pending,
      workspace: { id: 'workspace-1' },
      requester: {},
      view: {},
    });
    mockGetActiveSubscription.mockResolvedValue([SubscriptionPlan.Pro]);
    mockApproveRequestAccess.mockRejectedValue({
      code: ERROR_CODE.FREE_PLAN_GUEST_LIMIT_EXCEEDED,
      message: 'Contact your server administrator.',
    });
  });

  it('loads hosting outside the app shell and keeps upgrade dialogs hidden for self-hosted quotas', async () => {
    const { rerender } = render(<Page />);

    expect(mockUseServerInfo).toHaveBeenCalledWith(true, 'https://workspace.example.com');
    expect(mockApproveRequestAccess).not.toHaveBeenCalled();

    mockServerInfo = { status: 'available', info: { self_hosted: true } };
    rerender(<Page />);
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Contact your server administrator.'));
    expect(mockApproveRequestAccess).toHaveBeenCalledTimes(1);
    expect(mockGetActiveSubscription).not.toHaveBeenCalled();
    expect(screen.queryByText('upgradePlanModal.message')).toBeNull();
  });

  it('updates cloud upgrade visibility without approving the same request again', async () => {
    const { rerender } = render(<Page />);

    mockServerInfo = { status: 'available', info: { self_hosted: false } };
    rerender(<Page />);
    await waitFor(() => expect(screen.getByText('upgradePlanModal.message')).toBeTruthy());
    expect(mockApproveRequestAccess).toHaveBeenCalledTimes(1);
    expect(mockGetActiveSubscription).toHaveBeenCalledWith('workspace-1');

    mockServerInfo = { status: 'available', info: { self_hosted: true } };
    rerender(<Page />);
    await waitFor(() => expect(screen.queryByText('upgradePlanModal.message')).toBeNull());
    expect(mockApproveRequestAccess).toHaveBeenCalledTimes(1);
  });
});
