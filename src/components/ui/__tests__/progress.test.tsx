import { render } from '@testing-library/react';

import { Progress } from '@/components/ui/progress';

function rootOf(container: HTMLElement) {
  return container.firstElementChild as HTMLElement;
}

describe('Progress', () => {
  // The indeterminate spinner rotates its root element. A full-width block root
  // would swing the circle around the centre of the surrounding container
  // instead of spinning it in place, throwing it across the layout.
  it('keeps the spinning root sized to the circle', () => {
    const { container } = render(<Progress />);
    const root = rootOf(container);

    expect(root.className).toContain('animate-progress-container');
    expect(root.className).toContain('inline-block');
    expect(root.className.split(/\s+/)).not.toContain('block');
  });

  it('does not animate the root when it reports a determinate value', () => {
    const { container } = render(<Progress value={40} />);

    expect(rootOf(container).className).not.toContain('animate-progress-container');
  });

  it('renders a 20px circle for every variant', () => {
    (['default', 'inherit', 'primary'] as const).forEach((variant) => {
      const { container } = render(<Progress variant={variant} />);
      const svg = container.querySelector('svg');

      expect(svg?.getAttribute('width')).toBe('20');
      expect(svg?.getAttribute('height')).toBe('20');
    });
  });
});
