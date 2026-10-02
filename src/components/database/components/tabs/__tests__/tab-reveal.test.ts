import { expect } from '@jest/globals';

import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import {
  revealTabInScroller,
  TAB_REVEAL_EDGE_PADDING,
  TabRevealInput,
  tabRevealScrollOffset,
} from '@/components/database/components/tabs/tab-reveal';

interface TabRevealFixture {
  cases: { name: string; input: TabRevealInput; expected: number }[];
}

const fixture = loadParityFixture<TabRevealFixture>('tab-reveal.json');

describe('tabRevealScrollOffset (dashboard-parity/tab-reveal.json)', () => {
  it('covers visible, both edges, wider than the viewport and both clamps', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(6);
    expect(TAB_REVEAL_EDGE_PADDING).toBe(16);
  });

  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    expect(tabRevealScrollOffset(entry.input)).toBe(entry.expected);
  });
});

describe('revealTabInScroller', () => {
  function element(rect: { left: number; width: number }, size: Partial<Record<'clientWidth' | 'scrollWidth', number>> = {}) {
    const node = document.createElement('div');

    node.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, top: 0, bottom: 34, height: 34, x: rect.left, y: 0, toJSON: () => rect });
    Object.entries(size).forEach(([key, value]) => Object.defineProperty(node, key, { configurable: true, value }));
    return node;
  }

  it('moves only the strip so a tab past its end is fully visible', () => {
    const scroller = element({ left: 100, width: 400 }, { clientWidth: 400, scrollWidth: 1000 });
    // Tab content start 700 (viewport-relative 600 + 100 page offset), 80 wide.
    const tab = element({ left: 800, width: 80 });

    expect(revealTabInScroller(scroller, tab)).toBe(true);
    expect(scroller.scrollLeft).toBe(700 + 80 + 16 - 400);
  });

  it('measures from the current scroll offset and leaves a visible tab alone', () => {
    const scroller = element({ left: 0, width: 400 }, { clientWidth: 400, scrollWidth: 1000 });

    scroller.scrollLeft = 300;
    // On screen at 50..130, i.e. content 350..430: inside the viewport 300..700.
    expect(revealTabInScroller(scroller, element({ left: 50, width: 80 }))).toBe(false);
    expect(scroller.scrollLeft).toBe(300);
  });
});
