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
        setTier={jest.fn()}
        setAnonymous={jest.fn()}
        url='https://appflowy.test/form/token'
      />,
    );

    expect(screen.getByText('Network unavailable')).toBeTruthy();
    fireEvent.click(screen.getByTestId('form-share-popover-retry'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
