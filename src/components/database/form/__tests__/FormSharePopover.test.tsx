import { fireEvent, render, screen } from '@testing-library/react';

import { FormSharePopover } from '../FormSharePopover';

import type { ReactNode } from 'react';

jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('FormSharePopover', () => {
  it('exposes an explicit retry for a generic bootstrap failure', () => {
    const onRetry = jest.fn();

    render(
      <FormSharePopover
        trigger={<button type='button'>Share form</button>}
        info={null}
        isLoading={false}
        errorKind='other'
        errorMessage='Network unavailable'
        onUpgradePlan={jest.fn()}
        onRetry={onRetry}
        canBroadenAccess={true}
        setTier={jest.fn()}
        setAnonymous={jest.fn()}
        url='https://appflowy.test/form/token'
      />
    );

    expect(screen.getByText('Network unavailable')).toBeTruthy();
    fireEvent.click(screen.getByTestId('form-share-popover-retry'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not copy a guessed URL when the server share URL is unconfigured', () => {
    render(
      <FormSharePopover
        trigger={<button type='button'>Share form</button>}
        info={{
          token: 'c6c31f9b-c334-4e3a-be20-79f661d4ad87',
          tier: 'workspace',
          anonymous: false,
          submission_access: 'none',
          share_url: '',
          created_at: '2026-08-28T00:00:00Z',
        }}
        isLoading={false}
        errorKind={null}
        errorMessage={null}
        onUpgradePlan={jest.fn()}
        onRetry={jest.fn()}
        canBroadenAccess={true}
        setTier={jest.fn()}
        setAnonymous={jest.fn()}
        url=''
      />
    );

    expect(screen.getByPlaceholderText('Share URL is not configured')).toBeTruthy();
    expect(screen.getByText('Copy form link').closest('button')?.disabled).toBe(true);
  });

  it('lets a downgraded owner close an active share but paywalls broader settings', () => {
    const setTier = jest.fn();
    const setAnonymous = jest.fn();
    const onUpgradePlan = jest.fn();

    render(
      <FormSharePopover
        trigger={<button type='button'>Share form</button>}
        info={{
          token: 'active-token',
          tier: 'workspace',
          anonymous: false,
          submission_access: 'none',
          share_url: 'https://appflowy.test/form/active-token',
          created_at: '2026-08-28T00:00:00Z',
        }}
        isLoading={false}
        errorKind={null}
        errorMessage={null}
        onUpgradePlan={onUpgradePlan}
        onRetry={jest.fn()}
        canBroadenAccess={false}
        setTier={setTier}
        setAnonymous={setAnonymous}
        url='https://appflowy.test/form/active-token'
      />
    );

    fireEvent.click(screen.getByTestId('form-share-tier-choice-closed'));
    expect(setTier).toHaveBeenCalledWith('closed');

    fireEvent.click(screen.getByTestId('form-share-tier-choice-public'));
    expect(onUpgradePlan).toHaveBeenCalledTimes(1);
    expect(setTier).not.toHaveBeenCalledWith('public');
    expect(screen.getByTestId('form-share-anonymous-toggle').disabled).toBe(true);
  });

  it('requires an upgrade to reopen a closed share after a downgrade', () => {
    const setTier = jest.fn();
    const onUpgradePlan = jest.fn();

    render(
      <FormSharePopover
        trigger={<button type='button'>Share form</button>}
        info={{
          token: 'closed-token',
          tier: 'closed',
          anonymous: false,
          submission_access: 'none',
          share_url: 'https://appflowy.test/form/closed-token',
          created_at: '2026-08-28T00:00:00Z',
        }}
        isLoading={false}
        errorKind={null}
        errorMessage={null}
        onUpgradePlan={onUpgradePlan}
        onRetry={jest.fn()}
        canBroadenAccess={false}
        setTier={setTier}
        setAnonymous={jest.fn()}
        url='https://appflowy.test/form/closed-token'
      />
    );

    fireEvent.click(screen.getByTestId('form-share-tier-choice-workspace'));

    expect(onUpgradePlan).toHaveBeenCalledTimes(1);
    expect(setTier).not.toHaveBeenCalled();
  });
});
