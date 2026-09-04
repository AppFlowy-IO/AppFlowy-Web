import { fireEvent, render, screen } from '@testing-library/react';

import { FormSharePopover } from '../FormSharePopover';

import type { ComponentProps, ReactNode } from 'react';

jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const activeInfo = {
  token: 'active-token',
  tier: 'workspace' as const,
  anonymous: false,
  submission_access: 'none' as const,
  share_url: 'https://appflowy.test/form/active-token',
  created_at: '2026-08-28T00:00:00Z',
};

function renderPopover(overrides: Partial<ComponentProps<typeof FormSharePopover>> = {}) {
  const props: ComponentProps<typeof FormSharePopover> = {
    trigger: <button type='button'>Share form</button>,
    info: activeInfo,
    isLoading: false,
    errorMessage: null,
    onRetry: jest.fn(),
    onRetryMutation: jest.fn(),
    canUpdateSettings: true,
    setTier: jest.fn(),
    setAnonymous: jest.fn(),
    url: activeInfo.share_url,
    ...overrides,
  };

  render(<FormSharePopover {...props} />);
  return props;
}

describe('FormSharePopover', () => {
  it('exposes an explicit retry for a bootstrap failure', () => {
    const onRetry = jest.fn();

    renderPopover({ info: null, errorMessage: 'Network unavailable', onRetry });

    expect(screen.getByText('Network unavailable')).toBeTruthy();
    fireEvent.click(screen.getByTestId('form-share-popover-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not copy a guessed URL when the server share URL is unconfigured', () => {
    const onRetry = jest.fn();

    renderPopover({ info: { ...activeInfo, share_url: '' }, onRetry, url: '' });

    expect(screen.getByTestId('form-share-link-unavailable')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Form share URL' })).toBeNull();
    expect(screen.queryByText('Copy form link')).toBeNull();
    fireEvent.click(screen.getByTestId('form-share-link-unavailable-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('allows an editor to change every share setting without a plan gate', () => {
    const setTier = jest.fn();

    renderPopover({ setTier });

    fireEvent.click(screen.getByTestId('form-share-tier-choice-public'));
    fireEvent.click(screen.getByTestId('form-share-tier-choice-closed'));

    expect(setTier).toHaveBeenCalledWith('public');
    expect(setTier).toHaveBeenCalledWith('closed');
    expect(screen.getByTestId('form-share-anonymous-toggle').disabled).toBe(false);
  });

  it('allows an editor to reopen a closed share', () => {
    const setTier = jest.fn();

    renderPopover({ info: { ...activeInfo, tier: 'closed' }, setTier });

    fireEvent.click(screen.getByTestId('form-share-tier-choice-workspace'));
    expect(setTier).toHaveBeenCalledWith('workspace');
  });

  it('surfaces an active-token mutation failure and retries the retained intent', () => {
    const onRetryMutation = jest.fn();

    renderPopover({ errorMessage: 'Network unavailable', onRetryMutation });

    expect(screen.getByTestId('form-share-mutation-error').textContent).toContain('Network unavailable');
    fireEvent.click(screen.getByTestId('form-share-mutation-retry'));
    expect(onRetryMutation).toHaveBeenCalledTimes(1);
  });

  it('lets view-only users inspect and copy an active link without exposing mutations', () => {
    const setTier = jest.fn();
    const setAnonymous = jest.fn();

    renderPopover({ canUpdateSettings: false, setTier, setAnonymous });

    expect(screen.getByDisplayValue(activeInfo.share_url)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Form share URL' })).toBeTruthy();
    expect(screen.getByText('Copy form link').closest('button')?.disabled).toBe(false);
    expect(screen.getByTestId('form-share-anonymous-toggle').disabled).toBe(true);
    expect(screen.getByTestId('form-share-tier-choice-workspace').disabled).toBe(true);
    expect(screen.getByTestId('form-share-tier-choice-public').disabled).toBe(true);
    expect(screen.getByTestId('form-share-tier-choice-closed').disabled).toBe(true);

    fireEvent.click(screen.getByTestId('form-share-tier-choice-closed'));
    expect(setTier).not.toHaveBeenCalled();
    expect(setAnonymous).not.toHaveBeenCalled();
  });

  it('explains and allows a GET-only retry when a view-only Form has no active share link', () => {
    const onRetry = jest.fn();

    renderPopover({ info: null, errorMessage: null, onRetry, canUpdateSettings: false, url: '' });

    expect(screen.getByTestId('form-share-popover-no-active-link')).toBeTruthy();
    fireEvent.click(screen.getByTestId('form-share-popover-no-active-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
