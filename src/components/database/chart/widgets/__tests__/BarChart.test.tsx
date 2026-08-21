import { render, screen } from '@testing-library/react';

import BarChartWidget from '@/components/database/chart/widgets/BarChart';

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  disconnect() {
    // The test has no persistent observation lifecycle to clean up.
  }

  observe(target: Element) {
    this.callback(
      [
        {
          borderBoxSize: [],
          contentBoxSize: [],
          contentRect: {
            bottom: 400,
            height: 400,
            left: 0,
            right: 800,
            top: 0,
            width: 800,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          },
          devicePixelContentBoxSize: [],
          target,
        },
      ],
      this
    );
  }

  unobserve() {
    // Recharts only needs the initial measurement in this test.
  }
}

describe('BarChartWidget', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('renders the real Recharts component without an invalid hook call', () => {
    let container: HTMLElement | undefined;

    expect(() =>
      ({ container } = render(
        <BarChartWidget
          data={[
            {
              color: '#5B8FF9',
              label: 'In Progress',
              rowIds: ['row-1'],
              value: 1,
            },
          ]}
        />
      ))
    ).not.toThrow();

    expect(screen.getByTestId('bar-chart-widget')).toBeTruthy();
    expect(container?.querySelector('.recharts-wrapper')).not.toBeNull();
    expect(container?.querySelector('.recharts-bar-rectangle')).not.toBeNull();
  });
});
