import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { addDays } from './timeline.geometry';
import TimelineCanvas, { TimelineEntry } from './TimelineCanvas';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const start = new Date(2026, 8, 12).getTime();
const entries: TimelineEntry[] = Array.from({ length: 1000 }, (_, index) => ({
  id: String(index),
  kind: 'row',
  record: {
    id: String(index),
    title: `Task ${index}`,
    loaded: true,
    invalid: false,
    range: { start, end: addDays(start, 2), includeTime: false },
  },
}));

beforeEach(() => {
  jest.useFakeTimers();
  global.ResizeObserver = class {
    observe() {
      /* No layout engine in jsdom. */
    }
    unobserve() {
      /* No layout engine in jsdom. */
    }
    disconnect() {
      /* No layout engine in jsdom. */
    }
  };
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function mount(readOnly = false) {
  const onChange = jest.fn();

  render(
    <TimelineCanvas
      entries={entries}
      interactionKey='date'
      scale='month'
      anchor={{ time: start, revision: 0 }}
      locale='en-US'
      tableWidth={280}
      tableHeader='Name'
      readOnly={readOnly}
      renderTable={(record) => record.title}
      renderBarProperties={() => null}
      onOpen={jest.fn()}
      onChange={onChange}
      onToggleGroup={jest.fn()}
      onVisibleDate={jest.fn()}
      onNavigate={jest.fn()}
    />
  );
  return { onChange };
}

describe('timeline canvas', () => {
  it('renders a bounded window of a thousand aligned rows and changes it on scroll', () => {
    mount();
    expect(screen.getAllByTestId(/^timeline-row-/).length).toBeLessThan(35);
    const viewport = screen.getByTestId('timeline-viewport');

    viewport.scrollTop = 20_000;
    fireEvent.scroll(viewport);
    act(() => jest.advanceTimersByTime(20));
    expect(screen.queryByTestId('timeline-row-0')).toBeNull();
    expect(screen.getByTestId('timeline-row-500')).toBeTruthy();
    expect(screen.getAllByTestId(/^timeline-row-/).length).toBeLessThan(35);
  });

  it('offers keyboard movement with the same date semantics as a pointer gesture', () => {
    const { onChange } = mount();
    const button = screen.getByTestId('timeline-bar-0').querySelector('button')!;

    fireEvent.keyDown(button, { key: 'ArrowRight', altKey: true });
    expect(onChange).toHaveBeenCalledWith(
      '0',
      { start, end: addDays(start, 2), includeTime: false },
      { start: addDays(start, 1), end: addDays(start, 3), includeTime: false }
    );
  });

  it('disables date editing and resize handles in read-only views', () => {
    const { onChange } = mount(true);
    const bar = screen.getByTestId('timeline-bar-0');

    expect(bar.querySelectorAll('button')).toHaveLength(1);
    fireEvent.keyDown(bar.querySelector('button')!, { key: 'ArrowRight', altKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });
});
