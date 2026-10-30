import { describeSlideSources, numberSlideSources, slideSourceIds } from '../slide-sources';
import { cellId, databaseSource } from './fixtures/database-source';
import { sourceToSnapshot } from '../server-adapter';

import type { PageSnapshot, Slide, SourceBlock } from '../types';
import type { SourceEnvelope } from '../server-contract';

it('describes retrieved web citations separately from document passages', () => {
  const details = describeSlideSources({
    ...snapshot,
    serverSource: { references: {
      'web:captured': { location: { kind: 'web', url: 'https://example.com/article', retrievedAt: '2026-10-29T00:00:00Z', quote: 'Captured external evidence' }, evidenceKind: 'web_research', numeric: null },
      'web:invalid': { location: { kind: 'web', url: 'javascript:alert(1)', retrievedAt: '', quote: 'Unsafe' }, evidenceKind: 'web_research', numeric: null },
    } } as unknown as SourceEnvelope,
  });

  expect(details.get('web:captured')).toEqual({ documentTitle: 'example.com', section: 'External web source', excerpt: 'Captured external evidence' });
  expect(details.has('web:invalid')).toBe(false);
});

const block = (id: string, text: string, children: SourceBlock[] = []): SourceBlock => ({
  id, text, type: 'paragraph', children,
});

it('describes database citations with database, row and field names instead of IDs', () => {
  const details = describeSlideSources(sourceToSnapshot(databaseSource));

  expect(details.get(cellId)).toEqual({
    documentTitle: 'LLM Experiments', section: 'v4 Hard examples › Passing answers', excerpt: '88',
  });
});

it('keeps legacy database sources readable when field metadata is unavailable', () => {
  const source = { ...databaseSource, databaseViews: databaseSource.databaseViews.map((view) => ({ ...view, schema: null })) };

  expect(describeSlideSources(sourceToSnapshot(source)).get(cellId)).toEqual({
    documentTitle: 'LLM Experiments', section: '', excerpt: '88',
  });
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
