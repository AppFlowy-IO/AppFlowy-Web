import { render, screen } from '@testing-library/react';
import katex from 'katex';

import KatexMath from '../KatexMath';

afterEach(() => jest.restoreAllMocks());

it.each([false, true])('does not reparse unchanged equations on parent renders (inline=%s)', (isInline) => {
  const parse = jest.spyOn(katex, 'renderToString');
  const { rerender } = render(<KatexMath latex='x^2' isInline={isInline} />);

  expect(parse).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 3; i++) rerender(<KatexMath latex='x^2' isInline={isInline} />);
  expect(parse).toHaveBeenCalledTimes(1);
  rerender(<KatexMath latex='y^2' isInline={isInline} />);
  expect(parse).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('react-katex').textContent).toContain('y');
});

it.each([false, true])('recovers from invalid TeX after editing (inline=%s)', (isInline) => {
  const { rerender } = render(<KatexMath latex={String.raw`\bc`} isInline={isInline} />);

  expect(screen.getByRole('status').textContent).toContain('Undefined control sequence');
  rerender(<KatexMath latex='x' isInline={isInline} />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByTestId('react-katex').textContent).toContain('x');
});
