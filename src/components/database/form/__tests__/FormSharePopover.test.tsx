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
        onRetryMutation={jest.fn()}
        canUpdateSettings={true}
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
        onRetryMutation={jest.fn()}
        canUpdateSettings={true}
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
        onRetryMutation={jest.fn()}
        canUpdateSettings={true}
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
        onRetryMutation={jest.fn()}
        canUpdateSettings={true}
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

  it('surfaces an active-token mutation failure and retries the retained intent', () => {
    const onRetryMutation = jest.fn();

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
        errorKind='other'
        errorMessage='Network unavailable'
        onUpgradePlan={jest.fn()}
        onRetry={jest.fn()}
        onRetryMutation={onRetryMutation}
        canUpdateSettings={true}
        canBroadenAccess={true}
        setTier={jest.fn()}
        setAnonymous={jest.fn()}
        url='https://appflowy.test/form/active-token'
      />
    );

    expect(screen.getByTestId('form-share-mutation-error').textContent).toContain('Network unavailable');
    fireEvent.click(screen.getByTestId('form-share-mutation-retry'));

    expect(onRetryMutation).toHaveBeenCalledTimes(1);
  });

  it('retries a failed plan lookup for an already-active link', () => {
    const onRetryEntitlement = jest.fn();
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
        hasEntitlementError
        onRetryEntitlement={onRetryEntitlement}
        onRetry={jest.fn()}
        onRetryMutation={jest.fn()}
        canUpdateSettings
        canBroadenAccess={false}
        setTier={jest.fn()}
        setAnonymous={jest.fn()}
        url='https://appflowy.test/form/active-token'
      />
    );

    fireEvent.click(screen.getByTestId('form-share-entitlement-retry'));
    expect(onRetryEntitlement).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('form-share-tier-choice-public'));
    expect(onRetryEntitlement).toHaveBeenCalledTimes(2);
    expect(onUpgradePlan).not.toHaveBeenCalled();
  });

  it('lets view-only users inspect and copy an active link without exposing mutations', () => {
    const setTier = jest.fn();
    const setAnonymous = jest.fn();
    const onUpgradePlan = jest.fn();

    render(
      <FormSharePopover
        trigger={<button type='button'>Share form</button>}
        info={{
          token: 'view-only-token',
          tier: 'workspace',
          anonymous: false,
          submission_access: 'none',
          share_url: 'https://appflowy.test/form/view-only-token',
          created_at: '2026-08-28T00:00:00Z',
        }}
        isLoading={false}
        errorKind={null}
        errorMessage={null}
        onUpgradePlan={onUpgradePlan}
        onRetry={jest.fn()}
        onRetryMutation={jest.fn()}
        canUpdateSettings={false}
        canBroadenAccess={false}
        setTier={setTier}
        setAnonymous={setAnonymous}
        url='https://appflowy.test/form/view-only-token'
      />
    );

    expect(screen.getByDisplayValue('https://appflowy.test/form/view-only-token')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Form share URL' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Anonymous responses' })).toBeTruthy();
    expect(screen.getByTestId('form-share-tier-choice-workspace').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Copy form link').closest('button')?.disabled).toBe(false);
    expect(screen.getByTestId('form-share-anonymous-toggle').disabled).toBe(true);
    expect(screen.getByTestId('form-share-tier-choice-workspace').disabled).toBe(true);
    expect(screen.getByTestId('form-share-tier-choice-public').disabled).toBe(true);
    expect(screen.getByTestId('form-share-tier-choice-closed').disabled).toBe(true);

    fireEvent.click(screen.getByTestId('form-share-tier-choice-closed'));
    expect(setTier).not.toHaveBeenCalled();
    expect(setAnonymous).not.toHaveBeenCalled();
    expect(onUpgradePlan).not.toHaveBeenCalled();
  });

  it('explains and allows a GET-only retry when a view-only Form has no active share link', () => {
    const onRetry = jest.fn();

    render(
      <FormSharePopover
        trigger={<button type='button'>Share form</button>}
        info={null}
        isLoading={false}
        errorKind={null}
        errorMessage={null}
        onUpgradePlan={jest.fn()}
        onRetry={onRetry}
        onRetryMutation={jest.fn()}
        canUpdateSettings={false}
        canBroadenAccess={false}
        setTier={jest.fn()}
        setAnonymous={jest.fn()}
        url=''
      />
    );

    expect(screen.getByTestId('form-share-popover-no-active-link')).toBeTruthy();
    fireEvent.click(screen.getByTestId('form-share-popover-no-active-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
