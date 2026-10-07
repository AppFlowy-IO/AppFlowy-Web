import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import CardList, {
  CardListSizing,
  CardListSizingContext,
  CardType,
  ColumnOnScreenContext,
  DEFAULT_CARD_LIST_SIZING,
  estimateCardHeight,
  RenderCard,
} from '../CardList';

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
});
