import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { focusRingStandsApart, showsKeyboardFocus } from '@/__mocks__/keyboardFocus';
import { mockResizeObserver } from '@/__mocks__/resizeObserver';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { NormalModal } from '../NormalModal';

mockResizeObserver();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('NormalModal keyboard submission', () => {
  it('submits when Enter is pressed in a text input', () => {
    const onOk = jest.fn();

    render(
      <NormalModal open title='Single sign-on' onOk={onOk}>
        <input aria-label='Email' />
      </NormalModal>
    );

    fireEvent.keyDown(screen.getByLabelText('Email'), { key: 'Enter' });

    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it('does not submit when Enter bubbles from the cancel button', () => {
    const onOk = jest.fn();

    render(
      <NormalModal open title='Single sign-on' onOk={onOk}>
        <input aria-label='Email' defaultValue='person@example.com' />
      </NormalModal>
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'button.cancel' }), {
      key: 'Enter',
    });

    expect(onOk).not.toHaveBeenCalled();
  });

  it('shows keyboard focus on its footer buttons, also when it opens over another dialog', () => {
    render(
      <NormalModal open title='Switch space type?' okText='Switch'>
        <div>Members keep their access.</div>
      </NormalModal>
    );

    for (const button of [
      screen.getByRole('button', { name: 'button.cancel' }),
      screen.getByRole('button', { name: 'Switch' }),
    ]) {
      expect(showsKeyboardFocus(button)).toBe(true);
      // The OK button is a filled theme button; the ring needs a gap to stand out from it.
      expect(focusRingStandsApart(button)).toBe(true);
    }
  });

  it('can hide its footer actions while keeping the close control', () => {
    render(
      <NormalModal open title='Manage Space' showActions={false}>
        <div>Space settings</div>
      </NormalModal>
    );

    expect(screen.queryByRole('button', { name: 'button.cancel' })).toBeNull();
    expect(screen.queryByTestId('modal-ok-button')).toBeNull();
    expect(screen.getByRole('button', { name: 'button.close' })).toBeTruthy();
  });
});

describe('NormalModal height', () => {
  function classes(element: Element | null | undefined) {
    return (element?.className ?? '').split(/\s+/);
  }

  it('can let its body shrink to the dialog height, so a scroll area inside it uses the space that is left', () => {
    render(
      <NormalModal open title='Create space' fillAvailableHeight footerClassName='pr-1'>
        <div data-testid='content'>Space settings</div>
      </NormalModal>
    );
    const body = screen.getByTestId('content').parentElement;

    // A flex item only shrinks below the height of its content with a zero minimum height.
    expect(classes(body)).toEqual(expect.arrayContaining(['flex', 'flex-col', 'min-h-0']));
    expect(classes(body?.parentElement)).toContain('min-h-0');
    // The footer can line its buttons up with what is above them.
    expect(classes(screen.getByRole('button', { name: 'button.cancel' }).parentElement)).toContain('pr-1');
  });

  it('keeps its usual layout unless asked', () => {
    render(
      <NormalModal open title='Rename'>
        <div data-testid='content'>Name</div>
      </NormalModal>
    );
    const body = screen.getByTestId('content').parentElement;

    expect(classes(body)).not.toContain('min-h-0');
    expect(classes(body?.parentElement)).not.toContain('min-h-0');
  });
});

/**
 * In a browser, React removes a menu that closes on Escape before the key press reaches the dialog;
 * fireEvent runs inside act(), which keeps it mounted. A layer that handles Escape and stays open
 * reaches the dialog in both. The dialog must ignore either.
 */
describe('NormalModal Escape', () => {
  it('closes when Escape is pressed on one of its own controls', () => {
    const onClose = jest.fn();

    render(
      <NormalModal open title='Manage space' onClose={onClose}>
        <input aria-label='Space name' />
      </NormalModal>
    );

    fireEvent.keyDown(screen.getByLabelText('Space name'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open when a menu inside it uses Escape to close itself', async () => {
    const onClose = jest.fn();

    render(
      <NormalModal open title='Manage space' onClose={onClose}>
        <DropdownMenu>
          <DropdownMenuTrigger>Access</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Can view</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </NormalModal>
    );
    const trigger = screen.getByRole('button', { name: 'Access' });

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('menu');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    // The menu used that key press; the dialog and the user's place in it stay.
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    // A second Escape, now on the dialog's own control, closes the dialog.
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open when a picker inside it keeps itself open on Escape', async () => {
    const onClose = jest.fn();

    render(
      <NormalModal open title='Create space' onClose={onClose}>
        <Popover open>
          <PopoverTrigger>Change icon</PopoverTrigger>
          {/* For example while it uploads an icon. */}
          <PopoverContent onEscapeKeyDown={(event) => event.preventDefault()}>
            <input aria-label='Search icons' />
          </PopoverContent>
        </Popover>
      </NormalModal>
    );
    const search = await screen.findByRole('textbox', { name: 'Search icons' });

    act(() => search.focus());
    fireEvent.keyDown(search, { key: 'Escape' });

    expect(screen.getByRole('textbox', { name: 'Search icons' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
