import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { FormAccessBanner } from '../FormAccessBanner';
import { FormShareButton } from '../FormShareButton';

import type { ReactNode } from 'react';

let mockCanUpdateSettings = true;
let mockShareLoading = false;
let mockShareError: string | null = null;
let mockShareErrorKind: 'plan_required' | 'other' | null = null;
let mockShareInfo: {
  token: string;
  tier: 'public';
  anonymous: boolean;
  submission_access: 'none';
  share_url: string;
  created_at: string;
} | null = {
  token: 'active-token',
  tier: 'public',
  anonymous: true,
  submission_access: 'none',
  share_url: 'https://appflowy.test/form/active-token',
  created_at: '2026-08-28T00:00:00Z',
};

jest.mock('../useCanAuthorFormView', () => ({
  useCanAuthorFormView: () => ({
    canAuthor: false,
    isLoading: false,
    hasError: false,
    ensureCanAuthor: jest.fn(),
  }),
}));

jest.mock('../FormShareContext', () => ({
  useFormShareContext: () => ({
    canUpdateSettings: mockCanUpdateSettings,
    info: mockShareInfo,
    isLoading: mockShareLoading,
    error: mockShareError,
    errorKind: mockShareErrorKind,
    retryBootstrap: jest.fn(),
    retryMutation: jest.fn(),
    setTier: jest.fn(),
    setAnonymous: jest.fn(),
    setSubmissionAccess: jest.fn(),
    resolveShareUrl: () => 'https://appflowy.test/form/active-token',
  }),
}));

jest.mock('../FormSharePopover', () => ({
  FormSharePopover: ({
    trigger,
    canBroadenAccess,
    canUpdateSettings,
  }: {
    trigger: ReactNode;
    canBroadenAccess: boolean;
    canUpdateSettings: boolean;
  }) => (
    <div
      data-testid='existing-share-settings'
      data-can-broaden={canBroadenAccess ? 'true' : 'false'}
      data-can-update={canUpdateSettings ? 'true' : 'false'}
    >
      {trigger}
    </div>
  ),
}));

function renderInRouter(node: ReactNode) {
  return render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>{node}</MemoryRouter>);
}

describe('downgraded Form share controls', () => {
  beforeEach(() => {
    mockCanUpdateSettings = true;
    mockShareLoading = false;
    mockShareError = null;
    mockShareErrorKind = null;
    mockShareInfo = {
      token: 'active-token',
      tier: 'public',
      anonymous: true,
      submission_access: 'none',
      share_url: 'https://appflowy.test/form/active-token',
      created_at: '2026-08-28T00:00:00Z',
    };
  });

  it.each([
    ['toolbar', <FormShareButton key='toolbar' />],
    ['access banner', <FormAccessBanner key='banner' />],
  ])('keeps existing share settings reachable from the %s without broader access', (_label, component) => {
    renderInRouter(component);

    expect(screen.getByTestId('existing-share-settings').getAttribute('data-can-broaden')).toBe('false');
  });

  it.each([
    ['toolbar', <FormShareButton key='toolbar' />],
    ['access banner', <FormAccessBanner key='banner' />],
  ])('keeps read-only link inspection reachable from the %s without mint controls', (_label, component) => {
    mockCanUpdateSettings = false;
    mockShareInfo = null;

    renderInRouter(component);

    const popover = screen.getByTestId('existing-share-settings');

    expect(popover.getAttribute('data-can-update')).toBe('false');
    expect(popover.getAttribute('data-can-broaden')).toBe('false');
  });

  it('labels a read-only missing link as unavailable in the access banner', () => {
    mockCanUpdateSettings = false;
    mockShareInfo = null;

    renderInRouter(<FormAccessBanner />);

    expect(screen.getByText('Form link unavailable.')).toBeTruthy();
    expect(screen.getByTestId('form-access-banner').getAttribute('data-tier')).toBe('unavailable');
  });

  it.each([
    ['toolbar', <FormShareButton key='toolbar-error' />],
    ['access banner', <FormAccessBanner key='banner-error' />],
  ])('keeps the %s retry popover reachable after a downgraded owner GET failure', (_label, component) => {
    mockShareInfo = null;
    mockShareError = 'Network unavailable';
    mockShareErrorKind = 'other';

    renderInRouter(component);

    expect(screen.getByTestId('existing-share-settings')).toBeTruthy();
  });
});
