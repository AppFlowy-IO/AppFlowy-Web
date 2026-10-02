import { act, fireEvent, render, screen } from '@testing-library/react';

import { ChartDataItem } from '@/application/database-yjs/chart.type';

import { ChartTooltipLayer } from '../ChartTooltipLayer';
import { useChartHover } from '../useChartHover';

const DATA: ChartDataItem[] = [{ key: 'a', label: 'A', value: 1, rowIds: [] }];

describe('ChartTooltipLayer', () => {
  const { innerWidth, innerHeight } = window;

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  });

  afterAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
  });

  function mockTooltipSize(width: number, height: number) {
    return jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width,
      height,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      toJSON: () => ({}),
    } as DOMRect);
  }

  it('renders in a fixed portal on the body, 12px right of and below the pointer', () => {
    const spy = mockTooltipSize(200, 100);
    const { container } = render(
      <ChartTooltipLayer position={{ clientX: 100, clientY: 50 }}>
        <span>tip</span>
      </ChartTooltipLayer>
    );
    const layer = screen.getByRole('tooltip');

    expect(container.contains(layer)).toBe(false);
    expect(layer.className).toContain('fixed');
    expect(layer.className).toContain('pointer-events-none');
    expect([layer.style.left, layer.style.top, layer.style.zIndex]).toEqual(['112px', '62px', '1250']);
    spy.mockRestore();
  });

  it('flips left and up at the right and bottom edges', () => {
    const spy = mockTooltipSize(200, 100);

    render(
      <ChartTooltipLayer position={{ clientX: 950, clientY: 780 }}>
        <span>tip</span>
      </ChartTooltipLayer>
    );
    const layer = screen.getByRole('tooltip');

    expect([layer.style.left, layer.style.top]).toEqual([`${950 - 12 - 200}px`, `${780 - 12 - 100}px`]);
    spy.mockRestore();
  });

  it('renders nothing without a pointer position', () => {
    render(<ChartTooltipLayer position={null}>tip</ChartTooltipLayer>);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('useChartHover', () => {
  function Harness({ data }: { data: ChartDataItem[] }) {
    const { hover, show, frameHandlers } = useChartHover(data);

    return (
      <div data-testid='frame' {...frameHandlers}>
        <button data-testid='show' onClick={() => show(0, { clientX: 5, clientY: 6 })} type='button' />
        <span data-testid='state'>{hover ? `${hover.index}@${hover.clientX},${hover.clientY}` : 'none'}</span>
      </div>
    );
  }

  const state = () => screen.getByTestId('state').textContent;
  const hoverFirst = () => fireEvent.click(screen.getByTestId('show'));

  it('follows the pointer inside the frame', () => {
    render(<Harness data={DATA} />);
    hoverFirst();
    expect(state()).toBe('0@5,6');
    fireEvent.mouseMove(screen.getByTestId('frame'), { clientX: 40, clientY: 30 });
    expect(state()).toBe('0@40,30');
  });

  it('clears on pointer leave and cancel', () => {
    render(<Harness data={DATA} />);
    hoverFirst();
    fireEvent.mouseLeave(screen.getByTestId('frame'));
    expect(state()).toBe('none');
    hoverFirst();
    fireEvent.pointerCancel(screen.getByTestId('frame'));
    expect(state()).toBe('none');
  });

  it('clears on window blur and on any scroll', () => {
    render(<Harness data={DATA} />);
    hoverFirst();
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(state()).toBe('none');
    hoverFirst();
    act(() => {
      document.body.dispatchEvent(new Event('scroll'));
    });
    expect(state()).toBe('none');
  });

  it('clears on a pointer move outside the frame, even without a leave event', () => {
    render(
      <>
        <Harness data={DATA} />
        <div data-testid='elsewhere' />
      </>
    );
    hoverFirst();
    fireEvent.mouseMove(screen.getByTestId('frame'), { clientX: 8, clientY: 9 });
    expect(state()).toBe('0@8,9');
    fireEvent.mouseMove(screen.getByTestId('elsewhere'), { clientX: 900, clientY: 900 });
    expect(state()).toBe('none');
  });

  it('clears when the data changes by content, not by identity', () => {
    const { rerender } = render(<Harness data={DATA} />);

    hoverFirst();
    rerender(<Harness data={DATA.map((item) => ({ ...item }))} />);
    expect(state()).toBe('0@5,6');
    rerender(<Harness data={[{ ...DATA[0], value: 2 }]} />);
    expect(state()).toBe('none');
  });
});
