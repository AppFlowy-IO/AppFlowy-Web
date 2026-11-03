import { Virtualizer } from '@tanstack/react-virtual';
import { fireEvent, render, screen } from '@testing-library/react';

import CardList, {
  CardListSizing,
  CardListSizingContext,
  CardType,
  ColumnOnScreenContext,
  DEFAULT_CARD_LIST_SIZING,
  estimateCardHeight,
  RenderCard,
  shouldAdjustCardScroll,
} from '../CardList';

import type { ReactNode } from 'react';

jest.mock('@/application/database-yjs', () => ({
  PADDING_END: 0,
}));

jest.mock('@/components/database/board/BoardProvider', () => ({
  useBoardActions: () => ({ setCreatingColumnId: jest.fn() }),
  useBoardSelection: () => ({ creatingColumnId: null }),
}));

jest.mock('@/components/database/components/board/card', () => ({
  Card: ({ rowId }: { rowId: string }) => <div data-testid='virtual-card'>{rowId}</div>,
}));

/** The visible height of a column's card list in a dashboard widget. */
const VIEWPORT_HEIGHT = 320;
/** The employees cards of the performance fixture show 19 fields. */
const FIELDS_PER_CARD = 19;
/** A dashboard widget: cards sized by their field count, one card of overscan (W5). */
const WIDGET_SIZING: CardListSizing = { estimatedCardHeight: estimateCardHeight(FIELDS_PER_CARD), overscan: 1 };

const cards: RenderCard[] = Array.from({ length: 40 }, (_, index) => ({ id: `row-${index}`, type: CardType.CARD }));

function renderColumn({ sizing, onScreen = true }: { sizing?: CardListSizing; onScreen?: boolean }) {
  const wrap = (children: ReactNode) => (
    <ColumnOnScreenContext.Provider value={onScreen}>
      {sizing ? <CardListSizingContext.Provider value={sizing}>{children}</CardListSizingContext.Provider> : children}
    </ColumnOnScreenContext.Provider>
  );

  return render(wrap(<CardList columnId='engineering' data={cards} fieldId='department-field' />));
}

describe('CardList sizing (W5)', () => {
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

  beforeAll(() => {
    // The column's scroller is the only element the virtualizer reads a size from.
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => VIEWPORT_HEIGHT });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 240 });
  });

  afterAll(() => {
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
    if (offsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
  });

  it('estimates a card from its field count', () => {
    // 22px of padding, 20px per field and 8px between two fields.
    expect(estimateCardHeight(FIELDS_PER_CARD)).toBe(546);
    expect(estimateCardHeight(1)).toBe(42);
    // Nothing known about the fields: the former estimate.
    expect(estimateCardHeight(0)).toBe(DEFAULT_CARD_LIST_SIZING.estimatedCardHeight);
  });

  it('mounts at most 3 cards of a 19-field column in a 320px widget viewport on first render', () => {
    renderColumn({ sizing: WIDGET_SIZING });

    const mounted = screen.getAllByTestId('virtual-card');

    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThanOrEqual(3);
  });

  it('mounted a dozen cards with the former 72px estimate and an overscan of 5', () => {
    // The budget above is not met by the former sizing, which boards outside widgets keep by default.
    renderColumn({});

    expect(screen.getAllByTestId('virtual-card').length).toBeGreaterThan(3);
  });

  it('mounts no card while its column is away from the board viewport, and keeps its height', () => {
    const { container } = renderColumn({ sizing: WIDGET_SIZING, onScreen: false });

    expect(screen.queryAllByTestId('virtual-card')).toHaveLength(0);
    const content = container.querySelector('.appflowy-custom-scroller > div') as HTMLElement;

    expect(content.style.height).toBe(`${cards.length * estimateCardHeight(FIELDS_PER_CARD)}px`);
  });

  it('keeps the same scroller and virtual position while its column leaves and re-enters the viewport', () => {
    const column = (onScreen: boolean) => (
      <ColumnOnScreenContext.Provider value={onScreen}>
        <CardListSizingContext.Provider value={WIDGET_SIZING}>
          <CardList columnId='engineering' data={cards} fieldId='department-field' />
        </CardListSizingContext.Provider>
      </ColumnOnScreenContext.Provider>
    );
    const { container, rerender } = render(column(true));
    const scroller = container.querySelector('.appflowy-custom-scroller') as HTMLElement;
    const content = scroller.firstElementChild as HTMLElement;
    const visibleRows = () => screen.getAllByTestId('virtual-card').map((card) => card.textContent);

    expect(scroller.style.overflowY).toBe('auto');
    fireEvent.scroll(scroller, { target: { scrollTop: 4 * WIDGET_SIZING.estimatedCardHeight } });
    const scrolledRows = visibleRows();
    const scrollOffset = scroller.scrollTop;
    const virtualHeight = content.style.height;

    expect(scrolledRows).not.toContain('row-0');
    rerender(column(false));

    expect(container.querySelector('.appflowy-custom-scroller')).toBe(scroller);
    expect(scroller.firstElementChild).toBe(content);
    expect(scroller.style.overflowY).toBe('hidden');
    expect(scroller.scrollTop).toBe(scrollOffset);
    expect(content.style.height).toBe(virtualHeight);
    expect(screen.queryAllByTestId('virtual-card')).toHaveLength(0);

    rerender(column(true));

    expect(scroller.style.overflowY).toBe('auto');
    expect(scroller.scrollTop).toBe(scrollOffset);
    expect(content.style.height).toBe(virtualHeight);
    expect(visibleRows()).toEqual(scrolledRows);

    // The live virtualizer also follows a programmatic scroll while clipped.
    rerender(column(false));
    fireEvent.scroll(scroller, { target: { scrollTop: 8 * WIDGET_SIZING.estimatedCardHeight } });
    rerender(column(true));

    expect(scroller.scrollTop).toBe(8 * WIDGET_SIZING.estimatedCardHeight);
    expect(visibleRows()).not.toEqual(scrolledRows);
    expect(visibleRows()).not.toContain('row-0');
  });
});

describe('CardList measured scroll anchor', () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  function measuredColumn(sizes: number[], initialOffset: number) {
    const scroller = document.createElement('div');
    let reportOffset: (offset: number, isScrolling: boolean) => void = () => undefined;
    let start = 0;
    const measurements = sizes.map((size, index) => {
      const item = { index, key: index, start, size, end: start + size, lane: 0 };

      start = item.end;
      return item;
    });
    const virtualizer = new Virtualizer<HTMLDivElement, Element>({
      count: sizes.length,
      getScrollElement: () => scroller,
      estimateSize: (index) => sizes[index],
      initialOffset,
      initialMeasurementsCache: measurements,
      observeElementRect: (_, reportRect) => {
        reportRect({ width: 256, height: 280 });
        return () => undefined;
      },
      observeElementOffset: (_, onOffset) => {
        reportOffset = onOffset;
        reportOffset(scroller.scrollTop, false);
        return () => undefined;
      },
      // Like native scrollTo, the offset changes immediately; its scroll event
      // is delivered later, independently of a batch of resize observations.
      scrollToFn: (offset, { adjustments = 0 }) => {
        scroller.scrollTop = offset + adjustments;
      },
    });

    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = shouldAdjustCardScroll;
    cleanups.push(virtualizer._didMount());
    virtualizer._willUpdate();

    return {
      scroller,
      virtualizer,
      scrollEvent: () => reportOffset(scroller.scrollTop, false),
      relativeTop: (index: number) => {
        virtualizer.getVirtualItems();
        return virtualizer.measurementsCache[index].start - scroller.scrollTop;
      },
    };
  }

  it('preserves the visible card when remounted cards shrink and regain their measured heights', () => {
    // The employees Board: first row includes 7px more top padding, and two
    // field lines (56px) briefly disappear while remounted cells hydrate.
    const sizes = [575, 568, 568, 568, 568];
    const { scroller, virtualizer, scrollEvent, relativeTop } = measuredColumn(sizes, 600);
    const visibleCardTop = relativeTop(1);

    [519, 512, 512].forEach((size, index) => virtualizer.resizeItem(index, size));
    expect(scroller.scrollTop).toBe(544);
    expect(relativeTop(1)).toBe(visibleCardTop);
    scrollEvent();

    sizes.slice(0, 3).forEach((size, index) => virtualizer.resizeItem(index, size));
    scrollEvent();

    // The default start-before-offset policy incorrectly finishes at 656px.
    expect(scroller.scrollTop).toBe(600);
    expect(relativeTop(1)).toBe(visibleCardTop);
  });

  it.each([false, true])(
    'compensates all fully preceding cards with intermediate renders: %s',
    (renderBetweenMeasurements) => {
      const { scroller, virtualizer, scrollEvent, relativeTop } = measuredColumn(Array(12).fill(100), 325);
      const visibleCardTop = relativeTop(3);

      for (const size of [60, 100]) {
        for (let index = 0; index < 5; index++) {
          virtualizer.resizeItem(index, size);
          if (renderBetweenMeasurements) virtualizer.getVirtualItems();
        }

        expect(scroller.scrollTop).toBe(size === 60 ? 205 : 325);
        expect(relativeTop(3)).toBe(visibleCardTop);
        scrollEvent();
      }
    }
  );

  it('does not compensate a partly visible card or a card below it', () => {
    const { scroller, virtualizer, relativeTop } = measuredColumn(Array(12).fill(100), 325);

    virtualizer.resizeItem(3, 150);
    virtualizer.resizeItem(4, 60);

    expect(scroller.scrollTop).toBe(325);
    expect(relativeTop(3)).toBe(-25);
    virtualizer.resizeItem(3, 100);
    virtualizer.resizeItem(4, 100);

    expect(scroller.scrollTop).toBe(325);
    expect(relativeTop(3)).toBe(-25);
  });

  it('keeps the card at the viewport boundary anchored when the preceding card grows', () => {
    const { scroller, virtualizer, relativeTop } = measuredColumn(Array(12).fill(100), 300);

    virtualizer.resizeItem(2, 125);

    expect(scroller.scrollTop).toBe(325);
    expect(relativeTop(3)).toBe(0);
  });

  it('uses the new visible card after an ordinary vertical scroll', () => {
    const { scroller, virtualizer, scrollEvent, relativeTop } = measuredColumn(Array(12).fill(100), 325);

    scroller.scrollTop = 725;
    scrollEvent();
    virtualizer.resizeItem(6, 150);

    expect(scroller.scrollTop).toBe(775);
    expect(relativeTop(7)).toBe(-25);
    virtualizer.resizeItem(7, 150);

    expect(scroller.scrollTop).toBe(775);
    expect(relativeTop(7)).toBe(-25);
  });
});
