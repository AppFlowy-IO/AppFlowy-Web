import { fireEvent, render, screen } from '@testing-library/react';

import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('uses a native disabled state and suppresses clicks while loading', () => {
    const onClick = jest.fn();

    render(
      <Button loading onClick={onClick}>
        Continue
      </Button>
    );

    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' });

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not let the spread props replace its disabled click guard', () => {
    const onClick = jest.fn();

    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
