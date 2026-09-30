import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode, useState } from 'react';

import { MobileSheet, MobileSheetItem, MobileSheetSize } from '@/components/_shared/mobile-drawer';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

function Harness({
  onOpenChange = jest.fn(),
  onBack,
  size,
  ariaLabel,
  children = <div data-testid='sheet-content'>Rows</div>,
}: {
  onOpenChange?: jest.Mock;
  onBack?: () => void;
  size?: MobileSheetSize;
  ariaLabel?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <MobileSheet
      ariaLabel={ariaLabel}
      onBack={onBack}
      onOpenChange={(next) => {
        onOpenChange(next);
        setOpen(next);
      }}
      open={open}
      sheet='widget-filter'
      size={size}
      title='Filter'
    >
      {children}
    </MobileSheet>
  );
}

/** A value editor like the global filter pill's: a Radix popover with a text input. */
function PopoverEditor() {
  const [value, setValue] = useState('');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button data-testid='open-editor' type='button'>
          Edit value
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <input
          aria-label='Value'
          data-testid='editor-input'
          onChange={(event) => setValue(event.target.value)}
          value={value}
        />
      </PopoverContent>
    </Popover>
  );
}

describe('MobileSheet', () => {
  it('renders the handle, the title, the close button and the body', () => {
    render(<Harness />);
    const sheet = screen.getByTestId('mobile-sheet');

    expect(sheet.getAttribute('data-sheet')).toBe('widget-filter');
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.className).toContain('bottom-0');
    expect(sheet.className).toContain('rounded-t-500');
    expect(sheet.className).toContain('max-h-[85dvh]');
    expect(within(sheet).getByTestId('mobile-sheet-handle')).toBeTruthy();
    expect(within(sheet).getByTestId('mobile-sheet-title').textContent).toBe('Filter');
    expect(within(sheet).getByTestId('mobile-sheet-close').getAttribute('aria-label')).toBe('Close');
    expect(within(sheet).queryByTestId('mobile-sheet-back')).toBeNull();
    expect(within(within(sheet).getByTestId('mobile-sheet-body')).getByTestId('sheet-content')).toBeTruthy();
    // Named by its title unless an explicit label is given.
    expect(screen.getByRole('dialog', { name: 'Filter' })).toBe(sheet);
  });

  it('uses the explicit accessible name', () => {
    render(<Harness ariaLabel='Table data preview' />);

    expect(screen.getByRole('dialog', { name: 'Table data preview' })).toBe(screen.getByTestId('mobile-sheet'));
    expect(screen.getByTestId('mobile-sheet-title').textContent).toBe('Filter');
  });

  it('fills the viewport below the status bar at size full', () => {
    render(<Harness size='full' />);
    const sheet = screen.getByTestId('mobile-sheet');

    expect(sheet.getAttribute('data-size')).toBe('full');
    expect(sheet.className).toContain('h-[calc(100dvh-24px)]');
    expect(sheet.className).not.toContain('max-h-[85dvh]');
  });

  it('closes from the close button', () => {
    const onOpenChange = jest.fn();

    render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByTestId('mobile-sheet-close'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId('mobile-sheet')).toBeNull();
  });

  it('closes on Escape', () => {
    const onOpenChange = jest.fn();

    render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.keyDown(screen.getByTestId('mobile-sheet'), { key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId('mobile-sheet')).toBeNull();
  });

  it('shows a back chevron for a pushed screen', () => {
    const onBack = jest.fn();
    const onOpenChange = jest.fn();

    render(<Harness onBack={onBack} onOpenChange={onOpenChange} />);
    const back = screen.getByTestId('mobile-sheet-back');

    expect(back.getAttribute('aria-label')).toBe('Back');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('lets a nested Radix popover input take focus and typing', async () => {
    const onOpenChange = jest.fn();

    render(
      <Harness onOpenChange={onOpenChange}>
        <PopoverEditor />
      </Harness>
    );

    fireEvent.click(screen.getByTestId('open-editor'));
    const input = await screen.findByTestId('editor-input');

    // Portaled outside the sheet, like every Radix popover.
    expect(screen.getByTestId('mobile-sheet').contains(input)).toBe(false);

    fireEvent.pointerDown(input);
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'Doing' } });
    // Focus scopes settle on the next tick.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe('Doing');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('mobile-sheet')).toBeTruthy();
  });
});

describe('MobileSheetItem', () => {
  it('renders a 52px row with its id and selects on click', () => {
    const onSelect = jest.fn();

    render(
      <MobileSheetItem
        icon={<svg data-testid='item-icon' />}
        id='view-data-source'
        label='View data source'
        onSelect={onSelect}
      />
    );
    const item = screen.getByTestId('mobile-sheet-item');

    expect(item.getAttribute('data-item-id')).toBe('view-data-source');
    expect(item.className).toContain('min-h-[52px]');
    expect(item.textContent).toBe('View data source');
    expect(within(item).getByTestId('item-icon')).toBeTruthy();

    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('does not select while disabled', () => {
    const onSelect = jest.fn();

    render(<MobileSheetItem disabled id='new-view' label='New view' onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('mobile-sheet-item'));

    expect(onSelect).not.toHaveBeenCalled();
  });
});
