/**
 * Render budget of chart hover (W13 step 2): a hover change renders the
 * accessibility table 0 times (it is memoized and its rows keep their
 * identity), and the hovered category changes at most once per animation
 * frame however many pointer moves arrive in it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';

import { ChartDataItem } from '@/application/database-yjs/chart.type';
import BarChartWidget from '@/components/database/chart/widgets/BarChart';

import { useChartHover } from '../useChartHover';

import { hoverCategory, installChartEnvironment, renderChart, seriesDataOf } from './chartTestUtils';

/** Every key the components translated, in order: the accessibility table translates its label on each render. */
const mockTranslated: string[] = [];

jest.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string }) => {
    mockTranslated.push(key);
    return options?.defaultValue ?? key;
  };

  return { useTranslation: () => ({ t }) };
});

const A11Y_TABLE_LABEL = 'chart.a11y.table';
const tableRenders = () => mockTranslated.filter((key) => key === A11Y_TABLE_LABEL).length;

const DEPARTMENTS: ChartDataItem[] = ['Eng', 'Mktg', 'Prod', 'Dsgn', 'Sale', 'Supp', 'HR', 'Fin'].map(
  (label, index) => ({ key: label, label, value: (index + 1) * 1000, rowIds: [`r${index}`], color: '#4FB9C9' })
);

/** Recharts throttles its own mouse-move handling; the hover coalesces to animation frames. */
const nextFrame = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

describe('ChartA11yTable during hover', () => {
  installChartEnvironment();

  beforeEach(() => {
    mockTranslated.length = 0;
  });

  it('renders 0 times when the hovered category changes, and again for new data', async () => {
    const data = seriesDataOf(DEPARTMENTS);
    const { container, rerenderChart } = renderChart(<BarChartWidget data={data} onItemClick={jest.fn()} />);

    expect(tableRenders()).toBeGreaterThan(0);
    const settled = tableRenders();

    act(() => hoverCategory(container, 1));
    expect(screen.getByTestId('chart-tooltip-name').textContent).toBe('Mktg');
    await nextFrame();
    act(() => hoverCategory(container, 5));
    await nextFrame();
    expect(screen.getByTestId('chart-tooltip-name').textContent).toBe('Supp');
    act(() => {
      fireEvent.mouseLeave(screen.getByTestId('bar-chart-widget'));
    });
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    expect(tableRenders()).toBe(settled);

    // Not frozen: new data renders the table.
    rerenderChart(<BarChartWidget data={seriesDataOf(DEPARTMENTS.slice(0, 4))} onItemClick={jest.fn()} />);
    expect(tableRenders()).toBe(settled + 1);
    expect(screen.getByTestId('chart-data-table').querySelectorAll('tr')).toHaveLength(4);
  });
});

describe('useChartHover frame budget', () => {
  let renders = 0;
  const DATA = DEPARTMENTS;

  function Harness() {
    const { hoveredIndex, show, leave } = useChartHover(DATA);

    renders += 1;
    return (
      <div>
        <output data-testid='index'>{hoveredIndex === null ? 'none' : hoveredIndex}</output>
        <button
          data-testid='sweep'
          onClick={() => [1, 2, 3, 4, 5].forEach((index) => show(index, { clientX: index, clientY: 0 }))}
          type='button'
        />
        <button data-testid='leave' onClick={leave} type='button' />
      </div>
    );
  }

  const index = () => screen.getByTestId('index').textContent;

  beforeEach(() => {
    renders = 0;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('applies the first move of a frame at once and only the last of the others on the next frame', () => {
    render(<Harness />);
    const settled = renders;

    fireEvent.click(screen.getByTestId('sweep'));
    expect(index()).toBe('1');
    expect(renders).toBe(settled + 1);

    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(index()).toBe('5');
    expect(renders).toBe(settled + 2);

    // A frame with no move changes nothing.
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(renders).toBe(settled + 2);
  });

  it('ends the hover at once on leave, dropping the moves left for the next frame', () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId('sweep'));
    fireEvent.click(screen.getByTestId('leave'));
    expect(index()).toBe('none');
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(index()).toBe('none');
  });
});
