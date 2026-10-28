import { describeSlideSources, numberSlideSources, slideSourceIds } from '../slide-sources';

import type { PageSnapshot, Slide, SourceBlock } from '../types';

const block = (id: string, text: string, children: SourceBlock[] = []): SourceBlock => ({
  id, text, type: 'paragraph', children,
});
const snapshot: PageSnapshot = {
  pageId: 'page', title: 'Product review', kind: 'document', revision: 'saved', warnings: [],
  blocks: [
    { ...block('heading', 'Results'), type: 'heading', level: 2 },
    block('evidence', 'Eight teams participated.'),
    { ...block('table', '', [block('row', '', [block('cell', 'Customer retention: 92%')])]), type: 'simple_table' },
    { ...block('next', 'Next steps'), type: 'heading', level: 2 },
    block('decision', 'Expand the program.'),
  ],
  properties: [{ id: 'budget', name: 'Budget', type: 'number', value: 0 }],
};
const slide = (id: string, sourceIds: string[]): Slide => ({
  id, sourceIds, title: id, layout: 'summary', message: '', points: [], notes: '', warnings: [],
});

it('numbers unique locations across the whole deck, including repeated table and chart references', () => {
  const one = slide('one', ['page', 'evidence', 'evidence']);
  const two: Slide = {
    ...slide('two', ['evidence', 'table']),
    table: { columns: ['Retention'], rows: [['92%']], sourceIds: ['cell', 'table'] },
    chart: { unit: '%', items: [{ label: 'Retention', value: 92, sourceId: 'cell' }] },
  };
  const three = slide('three', ['budget', 'evidence']);
  const references = numberSlideSources({ title: 'Review', slides: [one, two, three] }, describeSlideSources(snapshot));

  expect(slideSourceIds(two)).toEqual(['evidence', 'table', 'cell']);
  expect([...references].map(([id, ref]) => [id, ref.number])).toEqual([
    ['page', 1], ['evidence', 2], ['table', 3], ['cell', 4], ['budget', 5],
  ]);
  expect(slideSourceIds(three).map((id) => references.get(id)?.number)).toEqual([5, 2]);
});

it('describes source passages and their actual section, including nested table cells and zero-valued properties', () => {
  const details = describeSlideSources(snapshot);

  expect(details.get('evidence')).toEqual({
    documentTitle: 'Product review', section: 'Results', excerpt: 'Eight teams participated.',
  });
  expect(details.get('table')?.excerpt).toBe('Customer retention: 92%');
  expect(details.get('row')?.excerpt).toBe('Customer retention: 92%');
  expect(details.get('cell')?.section).toBe('Results');
  expect(details.get('decision')?.section).toBe('Next steps');
  expect(details.get('budget')?.excerpt).toBe('Budget: 0');
});

it('bounds hover excerpts without modifying source text and does not invent details for a missing location', () => {
  const text = 'Long source passage. '.repeat(1000);
  const details = describeSlideSources({ ...snapshot, blocks: [block('long', text)] });
  const references = numberSlideSources({ title: 'Review', slides: [slide('one', ['long', 'missing'])] }, details);

  expect(references.get('long')?.excerpt.length).toBeLessThanOrEqual(321);
  expect(references.get('long')?.excerpt).toMatch(/…$/);
  expect(references.get('missing')).toEqual({
    number: 2,
    documentTitle: 'Source unavailable',
    excerpt: 'This location is not available in the saved document snapshot.',
  });
});
