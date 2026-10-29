import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { documentUnitKey, paginateDocument } from '../document-pagination';
import DocumentPresenter from '../DocumentPresenter';
import { parseMarkdown, splitDocument } from '../source';
import { TABLE_DENSITIES, tableMeasureKey, tableRowKey, type TableDensity } from '../table-pagination';

import type { PageSnapshot, SourceBlock } from '../types';

jest.mock('../DocumentContentProvider', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@mui/material/Dialog', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const ROW: Record<TableDensity, number> = { comfortable: 100, compact: 60, dense: 40 };
const OVERHEAD = 36;

function table(id: string, rows: number, headerRow = false): SourceBlock {
  return {
    id,
    type: 'simple_table',
    text: '',
    table: { headerRow },
    children: Array.from({ length: rows }, (_, row) => ({
      id: `${id}-row-${row}`,
      type: 'simple_table_row',
      text: '',
      children: [{ id: `${id}-cell-${row}`, type: 'simple_table_cell', text: `${id} ${row}`, children: [] }],
    })),
  };
}

function heights(snapshot: PageSnapshot, densities: (key: string) => readonly TableDensity[]) {
  const result: Record<string, number> = { title: 50 };

  splitDocument(snapshot).forEach((section, sectionIndex) =>
    section.blocks.forEach((block, blockIndex) => {
      const key = documentUnitKey(sectionIndex, blockIndex);

      result[key] = 50;
      if (block.type !== 'simple_table') return;
      densities(key).forEach((density) => {
        result[tableMeasureKey(key, density)] = OVERHEAD + block.children.length * ROW[density];
        block.children.forEach((_, row) => {
          result[tableRowKey(key, density, row)] = ROW[density];
        });
      });
    })
  );
  return result;
}

describe('measuring compact and dense tables only when they can change a slide', () => {
  const snapshot = parseMarkdown('Intro\n## Results\nSummary\n---\nEnd');

  // Tables after an introduction may share its slide; a heading starts a new one.
  snapshot.blocks.splice(1, 0, table('short', 2));
  snapshot.blocks.splice(3, 0, table('long', 8, true));
  snapshot.blocks.splice(5, 0, table('medium', 4));
  const sections = splitDocument(snapshot);
  const all = heights(snapshot, () => TABLE_DENSITIES);
  const comfortable = heights(snapshot, () => ['comfortable']);

  it.each([150, 250, 300, 400, 520, 700, 1200])('keeps every slide identical at %ipx', (capacity) => {
    const condensed = new Set<string>();

    paginateDocument(sections, comfortable, capacity, condensed);
    const measured = heights(snapshot, (key) => (condensed.has(key) ? TABLE_DENSITIES : ['comfortable']));
    const again = new Set<string>();

    expect(paginateDocument(sections, measured, capacity, again)).toEqual(paginateDocument(sections, all, capacity));
    // A second pass reports the same tables, so the ruler settles after one extra render.
    expect([...again].sort()).toEqual([...condensed].sort());
  });

  it('skips the extra copies for tables that fit comfortably and measures the rest', () => {
    const roomy = new Set<string>();
    const tight = new Set<string>();

    paginateDocument(sections, comfortable, 2000, roomy);
    paginateDocument(sections, comfortable, 300, tight);
    expect(roomy.size).toBe(0);
    expect(tight.size).toBeGreaterThan(0);
  });
});

describe('the presenter ruler', () => {
  const boundingRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')!;

  beforeAll(() => {
    global.ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    } as unknown as typeof ResizeObserver;
    // A 800×400 slide. Rows have density-specific heights; other units are 50px tall.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.matches('main') ? 800 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.matches('main') ? 400 : 0;
      },
    });
    const height = (element: Element): number => {
      if (element.matches('tr')) {
        const variant = element.closest<HTMLElement>('[data-table-density]');

        return ROW[(variant?.dataset.tableDensity as TableDensity | undefined) ?? 'comfortable'];
      }

      if (element.matches('[data-table-density]'))
        return OVERHEAD + Array.from(element.querySelectorAll('tr')).reduce((sum, row) => sum + height(row), 0);
      if (element.matches('[data-document-unit]')) {
        const variants = Array.from(element.querySelectorAll('[data-table-density]'));

        return variants.length ? variants.reduce((sum, variant) => sum + height(variant), 0) : 50;
      }

      return 0;
    };

    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: Element) {
        return { height: height(this), width: 0, top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0 } as DOMRect;
      },
    });
  });
  afterAll(() => {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', boundingRect);
  });

  it('measures smaller densities only for a table that does not fit comfortably', () => {
    const snapshot = parseMarkdown('---');

    snapshot.blocks.unshift(table('fits', 2));
    snapshot.blocks.push(table('tall', 6));
    const { container } = render(
      <DocumentPresenter snapshot={snapshot} onClose={() => undefined} onSource={() => undefined} />
    );
    const variants = (key: string) =>
      Array.from(container.querySelectorAll(`[data-document-unit="${key}"] [data-table-density]`)).map(
        (element) => (element as HTMLElement).dataset.tableDensity
      );

    expect(variants(documentUnitKey(1, 0))).toEqual(['comfortable']);
    expect(variants(documentUnitKey(2, 0))).toEqual([...TABLE_DENSITIES]);
    // 6 comfortable rows need two slides; the compact copy keeps them on one.
    expect(screen.getByRole('main').getAttribute('aria-label')).toBe('Slide 1 of 3');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('main').querySelector('.ps-table-comfortable')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('main').querySelector('.ps-table-compact')?.textContent).toContain('6 rows');
  });
});
