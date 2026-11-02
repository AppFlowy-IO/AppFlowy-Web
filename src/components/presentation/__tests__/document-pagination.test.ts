import { documentUnitKey, paginateDocument } from '../document-pagination';
import { parseMarkdown, splitDocument } from '../source';
import { TABLE_DENSITIES, tableMeasureKey, tableRowKey } from '../table-pagination';

import type { SourceBlock } from '../types';

it.each([300, 600, 950])('does not make slides from trailing editor spacers after databases at %ipx', (capacity) => {
  const source = parseMarkdown(
    '## At-risk initiatives\nIntroduction\n## Next actions\nAnother introduction\n## End\nDone'
  );

  for (const index of [4, 2]) {
    source.blocks.splice(
      index,
      0,
      { id: `database-${index}`, type: 'grid', text: '', children: [], database: { viewIds: [`view-${index}`] } },
      { id: `spacer-${index}`, type: 'paragraph', text: ' \n ', richText: [{ text: ' \n ' }], children: [] }
    );
  }

  const original = JSON.stringify(source);
  const sections = splitDocument(source);
  const heights = Object.fromEntries(
    sections.flatMap((section, sectionIndex) =>
      section.blocks.map((block, blockIndex) => [documentUnitKey(sectionIndex, blockIndex), block.database ? 0 : 50])
    )
  );
  const pages = paginateDocument(sections, heights, capacity);

  expect(pages.map((page) => page.blocks.map((block) => block.id))).toEqual([
    [],
    [source.blocks[0].id, source.blocks[1].id],
    ['database-2'],
    [source.blocks[4].id, source.blocks[5].id],
    ['database-4'],
    [source.blocks[8].id, source.blocks[9].id],
  ]);
  expect(JSON.stringify(source)).toBe(original);
});

it('omits spacer-only sections but keeps inline objects, nested content and empty meeting frames', () => {
  const spacer: SourceBlock = { id: 'spacer', type: 'paragraph', text: '', children: [] };
  const visible: SourceBlock[] = [
    { ...spacer, id: 'mention', richText: [{ text: '', mention: { type: 'page', page_id: 'page' } }] },
    { ...spacer, id: 'formula', richText: [{ text: '', formula: 'x^2' }] },
    {
      ...spacer,
      id: 'child',
      children: [{ id: 'image', type: 'image', text: '', url: 'https://example.test/image.png', children: [] }],
    },
    { ...spacer, id: 'background', style: { backgroundColor: '#123456' } },
  ];
  const pages = paginateDocument(
    [
      { title: 'Title', titleSlide: true, blocks: [] },
      { title: '', blocks: [spacer] },
      ...visible.map((block) => ({ title: '', blocks: [block] })),
      { title: '', meeting: { ...spacer, type: 'ai_meeting' }, blocks: [spacer] },
    ],
    {},
    300
  );

  expect(pages).toHaveLength(6);
  expect(pages.slice(1, -1).flatMap((page) => page.blocks)).toEqual(visible);
  expect(pages.at(-1)?.meeting?.type).toBe('ai_meeting');
});

it('fits measured blocks while preserving source order and explicit section boundaries', () => {
  const source = parseMarkdown('## Heading\nOne\nTwo\nThree\n---\nFinal');
  const sections = splitDocument(source);
  const heights = { title: 50, '1:0': 60, '1:1': 170, '1:2': 170, '1:3': 170, '2:0': 30 };
  const before = JSON.stringify(source);
  const pages = paginateDocument(sections, heights, 300);

  expect(pages.map((p) => p.blocks.map((b) => b.text))).toEqual([[], ['Heading', 'One'], ['Two'], ['Three'], ['Final']]);
  expect(JSON.stringify(source)).toBe(before);
});

it('carries oversized blocks and title properties through overlapping continuation pages', () => {
  const sections = splitDocument(parseMarkdown('```\nlong code\n```\nAfter'));
  const pages = paginateDocument(sections, { title: 750, '1:0': 1100, '1:1': 50 }, 400);
  const codePages = pages.filter((p) => p.sourceKeys.includes(documentUnitKey(1, 0)));

  expect(pages.filter((p) => p.titleSlide)).toHaveLength(3);
  expect(codePages).toHaveLength(4);
  expect(codePages[0].scrollTop).toBe(0);
  expect(codePages.at(-1)!.scrollTop + 400).toBe(1100);
  for (let i = 1; i < codePages.length; i++) {
    expect(codePages[i].scrollTop).toBeLessThan(codePages[i - 1].scrollTop + 400);
    expect(codePages[i].blocks[0]).toBe(sections[1].blocks[0]);
  }

  expect(pages.at(-1)!.blocks[0].text).toBe('After');
});

it('keeps headings with the following block when the pair fits on an empty slide', () => {
  const sections = splitDocument(parseMarkdown('Intro\n## Heading\nDetails\n---\nEnd'));
  const pages = paginateDocument(sections, { title: 50, '1:0': 220, '1:1': 50, '1:2': 150, '2:0': 50 }, 300);

  expect(pages.map((p) => p.blocks.map((b) => b.text))).toEqual([[], ['Intro'], ['Heading', 'Details'], ['End']]);
});

it('keeps a heading with oversized content instead of leaving it below the preceding section', () => {
  const source = parseMarkdown('Intro\n### Key findings at a glance\nLong content\n---\nEnd');
  const sections = splitDocument(source);
  const pages = paginateDocument(sections, { title: 50, '1:0': 150, '1:1': 50, '1:2': 800, '2:0': 50 }, 300);
  const continued = pages.filter((page) => page.blocks.some((block) => block.text === 'Long content'));

  expect(pages[1].blocks.map((block) => block.text)).toEqual(['Intro']);
  expect(continued[0].blocks.map((block) => block.text)).toEqual(['Key findings at a glance', 'Long content']);
  expect(continued[0].scrollTop).toBe(0);
  expect(continued.at(-1)!.scrollTop + 300).toBe(850);
});

it('keeps consecutive subheadings with their content across the old six-block boundary', () => {
  const source = parseMarkdown('One\nTwo\nThree\nFour\nFive\n### Findings\n#### Detail\nEvidence');
  const sections = splitDocument(source);
  const heights = Object.fromEntries(source.blocks.map((_, index) => [documentUnitKey(1, index), 50]));
  const pages = paginateDocument(sections, heights, 300);

  expect(pages.map((page) => page.blocks.map((block) => block.text))).toEqual([
    [],
    ['One', 'Two', 'Three', 'Four', 'Five'],
    ['Findings', 'Detail', 'Evidence'],
  ]);
});

it.each([200, 300, 540, 800])('splits tables into unique complete rows at a %ipx slide height', (capacity) => {
  const source = parseMarkdown('Timeline\n### Key findings at a glance\n---\nEnd');
  const rows: SourceBlock[] = Array.from({ length: 5 }, (_, index) => ({
    id: `row-${index}`,
    type: 'simple_table_row',
    text: '',
    children: [{ id: `cell-${index}`, type: 'simple_table_cell', text: `Metric ${index}`, children: [] }],
  }));
  const table: SourceBlock = {
    id: 'table',
    type: 'simple_table',
    text: '',
    children: rows,
    table: { headerRow: false },
  };

  source.blocks.splice(2, 0, table);
  const before = JSON.stringify(source);
  const sections = splitDocument(source);
  const heights = {
    title: 50,
    '1:0': Math.max(100, capacity - 350),
    '1:1': 50,
    '1:2': 530,
    '2:0': 50,
    ...Object.fromEntries(
      TABLE_DENSITIES.flatMap((density) => [
        [tableMeasureKey('1:2', density), 530],
        ...rows.map((_, index) => [tableRowKey('1:2', density, index), 100]),
      ])
    ),
  };
  const pages = paginateDocument(sections, heights, capacity);
  const tablePages = pages.filter((page) => page.blocks.some((block) => block.id === table.id));

  expect(pages[1].blocks.map((block) => block.text)).toEqual(['Timeline']);
  expect(tablePages[0].blocks[0].text).toBe('Key findings at a glance');
  expect(
    tablePages.flatMap((page) => page.blocks.filter((block) => block.id === table.id).flatMap((block) => block.children))
  ).toEqual(rows);
  expect(tablePages.every((page) => page.partCount === 1 && page.scrollTop === 0)).toBe(true);
  expect(JSON.stringify(source)).toBe(before);
});

it.each([500, 300, 190])('shares the first table slide with its introduction only when it fits at %ipx', (capacity) => {
  const source = parseMarkdown('## Architecture\nA short introduction\n---\nEnd');
  const rows: SourceBlock[] = Array.from({ length: 7 }, (_, index) => ({
    id: `row-${index}`,
    type: 'simple_table_row',
    text: '',
    children: [],
  }));

  source.blocks.splice(2, 0, {
    id: 'table',
    type: 'simple_table',
    text: '',
    children: rows,
    table: { headerRow: true },
  });
  source.blocks.splice(2, 0, { id: 'empty', type: 'paragraph', text: '', children: [] });
  const heights = {
    title: 50,
    '1:0': 60,
    '1:1': 40,
    '1:2': 10,
    ...Object.fromEntries(
      TABLE_DENSITIES.flatMap((density) => [
        [tableMeasureKey('1:3', density), 386],
        ...rows.map((_, index) => [tableRowKey('1:3', density, index), 50]),
      ])
    ),
  };
  const pages = paginateDocument(splitDocument(source), heights, capacity);
  const tablePages = pages.filter((page) => page.table);
  const introduction = pages.filter((page) => page.blocks.some((block) => block.text === 'A short introduction'));

  expect(introduction).toHaveLength(1);
  if (capacity >= 300) {
    expect(introduction[0]).toBe(tablePages[0]);
    expect(tablePages[0].prefixHeight).toBe(110);
  } else expect(introduction[0].table).toBeUndefined();
  if (capacity === 500) expect(tablePages).toHaveLength(1);
  expect(tablePages.flatMap((page) => page.blocks.at(-1)!.children.slice(1))).toEqual(rows.slice(1));
  expect(pages.at(-1)!.blocks[0].text).toBe('End');
});
