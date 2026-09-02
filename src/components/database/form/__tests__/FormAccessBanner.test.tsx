import { render, screen } from '@testing-library/react';

import { FormAccessBanner } from '../FormAccessBanner';
import { FormShareState } from '../useFormShare';

import type { ReactNode } from 'react';

const mockUseFormShareContext = jest.fn<FormShareState, []>();

jest.mock('../FormShareContext', () => ({
  useFormShareContext: () => mockUseFormShareContext(),
}));

jest.mock('../FormSharePopover', () => ({
  FormSharePopover: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));

function shareState(overrides: Partial<FormShareState> = {}): FormShareState {
  return {
    canUpdateSettings: true,
    info: {
      token: 'token',
      tier: 'public',
      anonymous: true,
      submission_access: 'none',
      share_url: 'https://appflowy.test/form/token',
      created_at: '2026-08-28T00:00:00Z',
    },
    isLoading: false,
    error: null,
    retryBootstrap: jest.fn(),
    retryMutation: jest.fn(),
    setTier: jest.fn(),
    setAnonymous: jest.fn(),
    setSubmissionAccess: jest.fn(),
    resolveShareUrl: () => 'https://appflowy.test/form/token',
    ...overrides,
  };
}

describe('FormAccessBanner', () => {
  it('does not present an active share as healthy when its respondent URL is invalid', () => {
    mockUseFormShareContext.mockReturnValue(shareState({ resolveShareUrl: () => '' }));

    render(<FormAccessBanner />);

    expect(screen.getByText('Form link unavailable.')).toBeTruthy();
  });
});
