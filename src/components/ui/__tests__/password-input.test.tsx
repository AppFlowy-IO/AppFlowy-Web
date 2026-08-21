import { render, screen } from '@testing-library/react';

import { PasswordInput } from '@/components/ui/password-input';

describe('PasswordInput', () => {
  it.each([
    { disabled: true, inputPropsDisabled: false },
    { disabled: false, inputPropsDisabled: true },
  ])(
    'disables the input and visibility control when either disabled source is true',
    ({ disabled, inputPropsDisabled }) => {
      render(
        <PasswordInput
          disabled={disabled}
          inputProps={{
            'aria-label': 'Password',
            disabled: inputPropsDisabled,
          }}
        />
      );

      expect(screen.getByLabelText<HTMLInputElement>('Password').disabled).toBe(true);
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'show password' }).disabled).toBe(true);
    }
  );
});
