import { act, fireEvent, render, screen } from '@testing-library/react';

import { ChartDataItem } from '@/application/database-yjs/chart.type';

import { ChartTooltipLayer } from '../ChartTooltipLayer';
import { createChartPointer, useChartHover } from '../useChartHover';

const DATA: ChartDataItem[] = [{ key: 'a', label: 'A', value: 1, rowIds: [] }];

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

  it('renders in a fixed portal on the body, 12px right of and below the pointer', () => {
    const spy = mockTooltipSize(200, 100);
    const { container } = render(
      <ChartTooltipLayer pointer={createChartPointer({ clientX: 100, clientY: 50 })}>
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
      <ChartTooltipLayer pointer={createChartPointer({ clientX: 950, clientY: 780 })}>
        <span>tip</span>
      </ChartTooltipLayer>
    );
    const layer = screen.getByRole('tooltip');

    expect([layer.style.left, layer.style.top]).toEqual([`${950 - 12 - 200}px`, `${780 - 12 - 100}px`]);
    spy.mockRestore();
  });

  it('renders nothing without a pointer position', () => {
    render(<ChartTooltipLayer pointer={null}>tip</ChartTooltipLayer>);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('follows the pointer without measuring again, and measures when its content changes', () => {
    const spy = mockTooltipSize(200, 100);
    const pointer = createChartPointer({ clientX: 100, clientY: 50 });
    const tip = <span>tip</span>;
    const { rerender } = render(<ChartTooltipLayer pointer={pointer}>{tip}</ChartTooltipLayer>);
    const layer = screen.getByRole('tooltip');

    expect(spy).toHaveBeenCalledTimes(1);

    // A move writes the new position from the cached size: no layout read.
    pointer.set({ clientX: 300, clientY: 400 });
    expect([layer.style.left, layer.style.top]).toEqual(['312px', '412px']);
    pointer.set({ clientX: 950, clientY: 780 });
    expect([layer.style.left, layer.style.top]).toEqual([`${950 - 12 - 200}px`, `${780 - 12 - 100}px`]);
    expect(spy).toHaveBeenCalledTimes(1);

    // The same content is not measured again; new content is, once.
    rerender(<ChartTooltipLayer pointer={pointer}>{tip}</ChartTooltipLayer>);
    expect(spy).toHaveBeenCalledTimes(1);
    rerender(
      <ChartTooltipLayer pointer={pointer}>
        <span>another tip</span>
      </ChartTooltipLayer>
    );
    expect(spy).toHaveBeenCalledTimes(2);
    // React did not reset the position the layer wrote.
    expect([layer.style.left, layer.style.top]).toEqual([`${950 - 12 - 200}px`, `${780 - 12 - 100}px`]);
    spy.mockRestore();
  });

  it('stops following the pointer once it is closed', () => {
    const pointer = createChartPointer({ clientX: 100, clientY: 50 });
    const { rerender } = render(<ChartTooltipLayer pointer={pointer}>tip</ChartTooltipLayer>);

    rerender(<ChartTooltipLayer pointer={null}>tip</ChartTooltipLayer>);
    expect(() => pointer.set({ clientX: 1, clientY: 2 })).not.toThrow();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('useChartHover', () => {
  const TIP = <span>tip</span>;
  let renders = 0;

  function Harness({ data }: { data: ChartDataItem[] }) {
    const { hoveredIndex, pointer, show, frameHandlers } = useChartHover(data);

    renders += 1;
    return (
      <div data-testid='frame' {...frameHandlers}>
        <button data-testid='show' onClick={() => show(0, { clientX: 5, clientY: 6 })} type='button' />
        <span data-testid='index'>{hoveredIndex === null ? 'none' : hoveredIndex}</span>
        <ChartTooltipLayer pointer={hoveredIndex === null ? null : pointer}>{TIP}</ChartTooltipLayer>
      </div>
    );
  }

  /** `index@x,y`: the hovered category and where the tooltip follows the pointer to (12px off it). */
  const state = () => {
    const index = screen.getByTestId('index').textContent;
    const layer = screen.queryByRole('tooltip');

    if (index === 'none' || !layer) return 'none';
    return `${index}@${parseFloat(layer.style.left) - 12},${parseFloat(layer.style.top) - 12}`;
  };

  const hoverFirst = () => fireEvent.click(screen.getByTestId('show'));

  beforeEach(() => {
    renders = 0;
  });

  it('follows the pointer inside the frame', () => {
    render(<Harness data={DATA} />);
    hoverFirst();
    expect(state()).toBe('0@5,6');
    fireEvent.mouseMove(screen.getByTestId('frame'), { clientX: 40, clientY: 30 });
    expect(state()).toBe('0@40,30');
  });

  it('does not render the chart for a pointer move inside a category', () => {
    render(<Harness data={DATA} />);
    hoverFirst();
    const settled = renders;

    fireEvent.mouseMove(screen.getByTestId('frame'), { clientX: 40, clientY: 30 });
    fireEvent.pointerMove(screen.getByTestId('frame'), { clientX: 41, clientY: 31 });
    fireEvent.mouseMove(screen.getByTestId('frame'), { clientX: 60, clientY: 70 });
    expect(state()).toBe('0@60,70');
    expect(renders).toBe(settled);
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

  // `ChartProvider` keeps the array while the content is the same (see
  // `ChartProvider.test.tsx`), so a new array is new content.
  it('keeps the hover while the chart keeps its data, and clears it when the chart gets new data', () => {
    const { rerender } = render(<Harness data={DATA} />);

    hoverFirst();
    rerender(<Harness data={DATA} />);
    expect(state()).toBe('0@5,6');
    rerender(<Harness data={[{ ...DATA[0], value: 2 }]} />);
    expect(state()).toBe('none');
  });
});
