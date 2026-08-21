import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

import { NormalModal } from '../NormalModal';

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
});
