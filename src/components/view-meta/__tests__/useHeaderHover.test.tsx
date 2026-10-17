import { fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';

import { useHeaderHover } from '../useHeaderHover';

function HeaderWithMenu() {
  const { ref, isHover } = useHeaderHover();

  return (
    <div ref={ref} data-testid='header'>
      <output>{isHover ? 'Header hovered' : 'Header idle'}</output>
      {createPortal(<button>Remove verification</button>, document.body)}
    </div>
  );
}

it('does not reveal header actions when hovering a portaled verification menu', () => {
  render(<HeaderWithMenu />);
  const header = screen.getByTestId('header');
  const menu = screen.getByRole('button', { name: 'Remove verification' });

  fireEvent.mouseEnter(header);
  expect(screen.getByText('Header hovered')).toBeTruthy();
  fireEvent.mouseLeave(header, { relatedTarget: menu });
  fireEvent.mouseEnter(menu, { relatedTarget: header });
  expect(screen.getByText('Header idle')).toBeTruthy();
  fireEvent.mouseLeave(menu);
  fireEvent.mouseEnter(header);
  expect(screen.getByText('Header hovered')).toBeTruthy();
});
