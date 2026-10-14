import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { mockResizeObserver } from '@/__mocks__/resizeObserver';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

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
});
