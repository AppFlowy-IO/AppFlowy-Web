import { render } from '@testing-library/react';

import { ViewLayout } from '@/application/types';
import { ViewIcon } from '@/components/_shared/view-icon/ViewIcon';

// Jest maps every `.svg` to one stub (`svgrMock.tsx`), so these tests see that a glyph is drawn and how,
// not which file it is.
const svgOf = (container: HTMLElement) => container.querySelector('svg');

describe('ViewIcon', () => {
  it.each([
    ViewLayout.AIChat,
    ViewLayout.Grid,
    ViewLayout.Board,
    ViewLayout.Calendar,
    ViewLayout.Document,
    ViewLayout.Chart,
    ViewLayout.List,
    ViewLayout.Gallery,
    ViewLayout.Feed,
    ViewLayout.Form,
    ViewLayout.Timeline,
    ViewLayout.Dashboard,
  ])('draws a glyph for layout %s', (layout) => {
    const { container } = render(<ViewIcon layout={layout} size='unset' />);

    expect(container.children).toHaveLength(1);
    expect(svgOf(container)).not.toBeNull();
  });

  it('draws nothing for a layout without a glyph', () => {
    const { container } = render(<ViewIcon layout={999 as ViewLayout} size='small' />);

    expect(container.innerHTML).toBe('');
  });

  it.each([
    ['small', 'h-5 w-5'],
    ['medium', 'h-6 w-6'],
    ['large', 'h-8 w-8'],
    [20, 'h-[20px] w-[20px]'],
  ] as const)('sizes the glyph for size %s', (size, sizeClass) => {
    const { container } = render(<ViewIcon className='shrink-0' layout={ViewLayout.Grid} size={size} />);

    expect(svgOf(container)?.getAttribute('class')).toBe(`${sizeClass} shrink-0`);
  });

  it('adds no size class for an unset size, and none at all without a class name', () => {
    const { container, rerender } = render(<ViewIcon className='h-4 w-4' layout={ViewLayout.Grid} size='unset' />);

    expect(svgOf(container)?.getAttribute('class')).toBe('h-4 w-4');
    rerender(<ViewIcon layout={ViewLayout.Grid} size='unset' />);
    expect(svgOf(container)?.getAttribute('class')).toBe('');
  });

  it('hands every other prop to the svg (the dashboard title icon carries its parity id there)', () => {
    const { container } = render(
      <ViewIcon
        aria-hidden='true'
        data-parity-id='dash-widget-title-pill__icon'
        data-testid='title-icon'
        layout={ViewLayout.Chart}
        size='unset'
      />
    );
    const svg = svgOf(container);

    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('data-parity-id')).toBe('dash-widget-title-pill__icon');
    expect(svg?.getAttribute('data-testid')).toBe('title-icon');
  });
});
