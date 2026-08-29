import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { FormAccessBanner } from '../FormAccessBanner';
import { FormShareButton } from '../FormShareButton';

import type { ReactNode } from 'react';

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
    info: {
      token: 'active-token',
      tier: 'public',
      anonymous: true,
      submission_access: 'none',
      share_url: 'https://appflowy.test/form/active-token',
      created_at: '2026-08-28T00:00:00Z',
    },
    isLoading: false,
    error: null,
    errorKind: null,
    retryBootstrap: jest.fn(),
    setTier: jest.fn(),
    setAnonymous: jest.fn(),
    setSubmissionAccess: jest.fn(),
    resolveShareUrl: () => 'https://appflowy.test/form/active-token',
  }),
}));

jest.mock('../FormSharePopover', () => ({
  FormSharePopover: ({ trigger, canBroadenAccess }: { trigger: ReactNode; canBroadenAccess: boolean }) => (
    <div data-testid='existing-share-settings' data-can-broaden={canBroadenAccess ? 'true' : 'false'}>
      {trigger}
    </div>
  ),
}));

function renderInRouter(node: ReactNode) {
  return render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>{node}</MemoryRouter>);
}

describe('downgraded Form share controls', () => {
  it.each([
    ['toolbar', <FormShareButton key='toolbar' />],
    ['access banner', <FormAccessBanner key='banner' />],
  ])('keeps existing share settings reachable from the %s without broader access', (_label, component) => {
    renderInRouter(component);

    expect(screen.getByTestId('existing-share-settings').getAttribute('data-can-broaden')).toBe('false');
  });
});
