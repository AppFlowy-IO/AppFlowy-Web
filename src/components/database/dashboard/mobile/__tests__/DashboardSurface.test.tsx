import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactElement, useState } from 'react';

import { DashboardSurface } from '../DashboardSurface';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

function Harness({
  mobile,
  wrapTrigger,
  onTriggerClick,
}: {
  mobile: boolean;
  wrapTrigger?: (trigger: ReactElement) => ReactElement;
  onTriggerClick?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DashboardSurface
      mobile={mobile}
      onOpenChange={setOpen}
      open={open}
      popover={{ align: 'end', 'data-testid': 'surface-popover', className: 'w-[290px]' }}
      sheet={{ sheet: 'global-filter', title: 'Filter' }}
      trigger={
        <button data-testid='surface-trigger' onClick={onTriggerClick} type='button'>
          Open
        </button>
      }
      wrapTrigger={wrapTrigger}
    >
      <div data-testid='surface-content'>Menu</div>
    </DashboardSurface>
  );
}

describe('DashboardSurface', () => {
  it('opens a bottom sheet from a tap on a phone, keeping the trigger handler', async () => {
    const onTriggerClick = jest.fn();

    render(<Harness mobile onTriggerClick={onTriggerClick} />);
    const trigger = screen.getByTestId('surface-trigger');

    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('data-state')).toBe('closed');
    fireEvent.click(trigger);

    const sheet = screen.getByTestId('mobile-sheet');

    expect(onTriggerClick).toHaveBeenCalledTimes(1);
    expect(sheet.getAttribute('data-sheet')).toBe('global-filter');
    expect(within(sheet).getByTestId('mobile-sheet-title').textContent).toBe('Filter');
    expect(within(sheet).getByTestId('surface-content')).toBeTruthy();
    expect(screen.queryByTestId('surface-popover')).toBeNull();
    expect(trigger.getAttribute('data-state')).toBe('open');

    fireEvent.click(within(sheet).getByTestId('mobile-sheet-close'));
    await waitFor(() => expect(screen.queryByTestId('mobile-sheet')).toBeNull());
  });

  it('opens the popover on desktop, with its content props and the wrapper around its trigger', () => {
    const wrapTrigger = jest.fn((trigger: ReactElement) => <span data-testid='trigger-wrapper'>{trigger}</span>);

    render(<Harness mobile={false} wrapTrigger={wrapTrigger} />);
    expect(within(screen.getByTestId('trigger-wrapper')).getByTestId('surface-trigger')).toBeTruthy();
    fireEvent.click(screen.getByTestId('surface-trigger'));

    const popover = screen.getByTestId('surface-popover');

    expect(popover.className).toContain('w-[290px]');
    expect(within(popover).getByTestId('surface-content')).toBeTruthy();
    expect(screen.queryByTestId('mobile-sheet')).toBeNull();
  });

  it('never wraps the trigger on a phone', () => {
    const wrapTrigger = jest.fn((trigger: ReactElement) => trigger);

    render(<Harness mobile wrapTrigger={wrapTrigger} />);
    expect(wrapTrigger).not.toHaveBeenCalled();
  });
});
