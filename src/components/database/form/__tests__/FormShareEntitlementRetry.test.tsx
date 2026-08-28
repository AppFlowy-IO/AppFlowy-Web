import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { FormAccessBanner } from '../FormAccessBanner';
import { FormShareButton } from '../FormShareButton';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

const mockEnsureCanAuthor = jest.fn();
const mockRetryBootstrap = jest.fn();

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
    info: null,
    isLoading: false,
    error: null,
    errorKind: null,
    retryBootstrap: mockRetryBootstrap,
    setTier: jest.fn(),
    setAnonymous: jest.fn(),
    setSubmissionAccess: jest.fn(),
    resolveShareUrl: () => 'https://appflowy.test/form/token',
  }),
}));

jest.mock('../FormSharePopover', () => ({
  FormSharePopover: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
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
  });

  it('lets the toolbar retry a failed entitlement request', async () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <FormShareButton />
      </MemoryRouter>,
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
      </MemoryRouter>,
    );

    const retry = screen.getByRole('button', { name: /retry plan check/i });

    expect((retry as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(retry);

    await waitFor(() => expect(mockEnsureCanAuthor).toHaveBeenCalledTimes(1));
  });
});
