import type { Element } from 'slate';

import { snapshotFromSlate } from '../snapshot-adapter';
import { paginateTable, TABLE_DENSITIES, tableColumnWidths, tableMeasureKey, tableRowKey } from '../table-pagination';
import type { SourceBlock } from '../types';

beforeAll(() => {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
});

function table(count: number): SourceBlock {
  return {
    id: 'table',
    type: 'simple_table',
    text: '',
    table: { headerRow: true, headerColumn: true },
    children: Array.from({ length: count + 1 }, (_, row) => ({
      id: `row-${row}`,
      type: 'simple_table_row',
      text: '',
      children: [
        { id: `label-${row}`, type: 'simple_table_cell', text: row === 0 ? 'Metric' : `Metric ${row}`, children: [] },
        {
          id: `value-${row}`,
          type: 'simple_table_cell',
          text: row === 0 ? 'Description' : 'A longer explanation of the measurement and review period.',
          children: [],
        },
      ],
    })),
  };
}
function measurements(block: SourceBlock, rowSizes: number[]) {
  return Object.fromEntries(
    TABLE_DENSITIES.flatMap((density, index) => [
      [tableMeasureKey('table', density), block.children.length * rowSizes[index] + 36],
      ...block.children.map((_, row) => [tableRowKey('table', density, row), rowSizes[index]]),
    ])
  );
}

it('uses the largest readable density that fits the entire table on one slide', () => {
  const source = table(6);
  const pages = paginateTable(source, 'table', measurements(source, [80, 50, 40]), 400);

  expect(pages).toHaveLength(1);
  expect(pages[0].layout.density).toBe('compact');
  expect(pages[0].block.children).toEqual(source.children);
});

it('balances a long table over two slides, repeating only the column headers and retaining row labels', () => {
  const source = table(8);
  const before = JSON.stringify(source);
  const pages = paginateTable(source, 'table', measurements(source, [65, 60, 50]), 400);

  expect(pages).toHaveLength(2);
  expect(pages.map((page) => page.layout.rowEnd - page.layout.rowStart + 1)).toEqual([4, 4]);
  expect(pages.every((page) => page.block.children[0] === source.children[0])).toBe(true);
  expect(pages.flatMap((page) => page.block.children.slice(1))).toEqual(source.children.slice(1));
  expect(new Set(pages.flatMap((page) => page.sourceKeys)).size).toBe(8);
  expect(pages[0].layout.columnWidths).toEqual(pages[1].layout.columnWidths);
  expect(JSON.stringify(source)).toBe(before);
});

it('does not repeat data as headers when the source disables its header row', () => {
  const source = table(8);
  source.table!.headerRow = false;
  const pages = paginateTable(source, 'table', measurements(source, [65, 60, 50]), 400);

  expect(pages.flatMap((page) => page.block.children)).toEqual(source.children);
});

it('uses the remaining first-slide space and the full continuation space without duplicating rows', () => {
  const source = table(8);
  const pages = paginateTable(source, 'table', measurements(source, [50, 50, 50]), 400, 250);
  expect(pages).toHaveLength(2);
  expect(pages[0].height).toBeLessThanOrEqual(250);
  expect(pages[1].height).toBeLessThanOrEqual(400);
  expect(pages[0].block.children.length).toBeLessThan(pages[1].block.children.length);
  expect(pages.flatMap((page) => page.block.children.slice(1))).toEqual(source.children.slice(1));
});

it('preserves every row in very long tables and keeps an exceptionally tall row on just one page', () => {
  const source = table(40);
  const pages = paginateTable(source, 'table', measurements(source, [650, 600, 500]), 400);

  expect(pages.flatMap((page) => page.block.children.slice(1))).toEqual(source.children.slice(1));
  expect(pages.every((page) => page.layout.density === 'dense')).toBe(true);
});

it('preserves native table header flags and custom column proportions in snapshots', () => {
  const data = { enable_header_row: true, enable_header_column: false, column_widths: { '1': 400, '0': 200 } };
  const content = {
    type: 'page',
    children: [
      {
        type: 'simple_table',
        data,
        children: [
          {
            type: 'simple_table_row',
            children: [0, 1].map(() => ({ type: 'simple_table_cell', children: [{ text: '' }] })),
          },
        ],
      },
    ],
  } as unknown as Element;
  const snapshot = snapshotFromSlate('page', 'Example', content);

  expect(snapshot.blocks[0].table).toEqual({ headerRow: true, headerColumn: false, columnWidths: [200, 400] });
  const block = table(3);
  block.table = snapshot.blocks[0].table;
  expect(tableColumnWidths(block)[0]).toBeCloseTo(100 / 3);
  expect(tableColumnWidths(block)[1]).toBeCloseTo(200 / 3);
  expect(data.column_widths).toEqual({ '0': 200, '1': 400 });
});

it('keeps row formatting attached to source row IDs and copies cell text marks', () => {
  const content = {
    type: 'page',
    children: [
      {
        type: 'simple_table',
        blockId: 'table',
        data: { row_colors: { '1': '#def4ea' }, column_colors: { '1': '#fff0cc' }, row_aligns: { '1': 'Center' } },
        children: [0, 1].map((row) => ({
          type: 'simple_table_row',
          blockId: `row-${row}`,
          children: [
            {
              type: 'simple_table_cell',
              blockId: `cell-${row}`,
              children: [
                {
                  type: 'paragraph',
                  blockId: `paragraph-${row}`,
                  data: { bgColor: '#eeeeee' },
                  children: [
                    {
                      type: 'text',
                      children: [
                        { text: 'Metric ', bold: true },
                        { text: 'value', font_color: '#b62424' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        })),
      },
    ],
  } as unknown as Element;
  const before = JSON.stringify(content);
  const source = snapshotFromSlate('page', 'Example', content).blocks[0];

  expect(source.table).toMatchObject({
    headerRow: false,
    headerColumn: false,
    rowColors: { 'row-1': '#def4ea' },
    columnColors: { '1': '#fff0cc' },
    rowAligns: { 'row-1': 'Center' },
  });
  expect(source.children[1].children[0].children[0]).toMatchObject({
    text: 'Metric value',
    style: { backgroundColor: '#eeeeee' },
    richText: [
      { text: 'Metric ', bold: true },
      { text: 'value', font_color: '#b62424' },
    ],
  });
  expect(JSON.stringify(content)).toBe(before);
});
