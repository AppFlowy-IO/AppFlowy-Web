import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { FormAccessBanner } from '../FormAccessBanner';
import { FormShareButton } from '../FormShareButton';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

const mockEnsureCanAuthor = jest.fn();
const mockRetryBootstrap = jest.fn();
let mockShareInfo: {
  token: string;
  tier: 'workspace';
  anonymous: false;
  submission_access: 'none';
  share_url: string;
  created_at: string;
} | null = null;

jest.mock('../useCanAuthorFormView', () => ({
  useCanAuthorFormView: () => ({
    canAuthor: null,
    isLoading: false,
    hasError: true,
    ensureCanAuthor: mockEnsureCanAuthor,
  }),
}));

jest.mock('../FormShareContext', () => ({
  useFormShareContext: () => ({
    canUpdateSettings: true,
    info: mockShareInfo,
    isLoading: false,
    error: null,
    errorKind: null,
    retryBootstrap: mockRetryBootstrap,
    retryMutation: jest.fn(),
    setTier: jest.fn(),
    setAnonymous: jest.fn(),
    setSubmissionAccess: jest.fn(),
    resolveShareUrl: () => 'https://appflowy.test/form/token',
  }),
}));

jest.mock('../FormSharePopover', () => ({
  FormSharePopover: ({
    trigger,
    hasEntitlementError,
    onRetryEntitlement,
  }: {
    trigger: ReactNode;
    hasEntitlementError?: boolean;
    onRetryEntitlement?: () => void;
  }) => (
    <div>
      {trigger}
      {hasEntitlementError && (
        <button type='button' onClick={onRetryEntitlement}>
          Retry active-link plan check
        </button>
      )}
    </div>
  ),
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    loading: _loading,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => <button {...props}>{children}</button>,
}));

describe('form share entitlement retries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnsureCanAuthor.mockResolvedValue(true);
    mockShareInfo = null;
  });

  it('lets the toolbar retry a failed entitlement request', async () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <FormShareButton />
      </MemoryRouter>
    );

    const retry = screen.getByRole('button', { name: /retry plan check/i });

    expect((retry as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(retry);

    await waitFor(() => expect(mockEnsureCanAuthor).toHaveBeenCalledTimes(1));
  });

  it('lets the access banner retry a failed entitlement request', async () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <FormAccessBanner />
      </MemoryRouter>
    );

    const retry = screen.getByRole('button', { name: /retry plan check/i });

    expect((retry as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(retry);

    await waitFor(() => expect(mockEnsureCanAuthor).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['toolbar', <FormShareButton key='toolbar-active' />],
    ['access banner', <FormAccessBanner key='banner-active' />],
  ])('lets the %s retry plan verification while an active link is loaded', async (_label, component) => {
    mockShareInfo = {
      token: 'active-token',
      tier: 'workspace',
      anonymous: false,
      submission_access: 'none',
      share_url: 'https://appflowy.test/form/active-token',
      created_at: '2026-08-28T00:00:00Z',
    };

    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>{component}</MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /retry active-link plan check/i }));

    await waitFor(() => expect(mockEnsureCanAuthor).toHaveBeenCalledTimes(1));
  });
});
