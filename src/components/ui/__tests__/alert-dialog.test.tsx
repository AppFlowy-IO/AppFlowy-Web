import { render, screen, within } from '@testing-library/react';

import { showsKeyboardFocus } from '@/__mocks__/keyboardFocus';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

describe('AlertDialog', () => {
  it('shows keyboard focus on every button in it, including plain shared buttons', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent showCloseButton closeLabel='Close'>
          <AlertDialogTitle>Give W_RH_edit access to all spaces?</AlertDialogTitle>
          <AlertDialogDescription>Members of W_RH_edit will be able to view every space.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button type='button'>Give access</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
    const buttons = within(screen.getByRole('alertdialog')).getAllByRole('button');

    expect(buttons).toHaveLength(3);
    for (const button of buttons) expect(showsKeyboardFocus(button)).toBe(true);
  });
});
