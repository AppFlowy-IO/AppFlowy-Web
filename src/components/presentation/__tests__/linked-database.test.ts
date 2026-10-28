import type { Element } from 'slate';

import { DATABASE_BLOCK_TYPES } from '@/application/database-block';

import { paginateDocument } from '../document-pagination';
import { snapshotFromSlate } from '../snapshot-adapter';
import { parseMarkdown, splitDocument } from '../source';

beforeAll(() => {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
});

it.each(DATABASE_BLOCK_TYPES)('copies linked %s references without expanding or changing the document', (type) => {
  const data = { view_ids: ['linked-view', 'list-view'], database_id: 'database', parent_id: 'page' };
  const content = {
    type: 'page',
    children: [{ type, blockId: 'embed', data, children: [{ text: '' }] }],
  } as unknown as Element;
  const before = JSON.stringify(content);
  const block = snapshotFromSlate('page', 'Test', content).blocks[0];

  expect(block.database).toEqual({ viewIds: data.view_ids, databaseId: 'database', parentId: 'page' });
  expect(block.database?.viewIds).not.toBe(data.view_ids);
  expect(block.children).toEqual([]);
  expect(JSON.stringify(content)).toBe(before);
});

it('preserves legacy view_id references and enough information to recover missing view IDs', () => {
  const content = {
    type: 'page',
    children: [
      { type: 'grid', data: { view_id: 'legacy-view' }, children: [{ text: '' }] },
      { type: 'grid', data: { database_id: 'database' }, children: [{ text: '' }] },
    ],
  } as unknown as Element;
  const blocks = snapshotFromSlate('page', 'Test', content).blocks;

  expect(blocks.map((block) => block.database)).toEqual([
    { viewIds: ['legacy-view'], parentId: 'page' },
    { viewIds: [], databaseId: 'database', parentId: 'page' },
  ]);
});

it.each([300, 600, 950])('keeps a database in one bounded viewport at %ipx without duplicating it', (height) => {
  const snapshot = parseMarkdown('Intro\n### Linked work\nAfter');
  snapshot.blocks.splice(2, 0, {
    id: 'embed',
    type: 'grid',
    text: '',
    children: [],
    database: { viewIds: ['linked-view'] },
  });
  const slides = paginateDocument(
    splitDocument(snapshot),
    { title: 50, '1:0': 50, '1:1': 60, '1:2': 5000, '1:3': 50 },
    height
  );
  const databases = slides.filter((slide) => slide.database);
  expect(databases).toHaveLength(1);
  expect(databases[0].blocks.map((block) => block.id)).toEqual([snapshot.blocks[1].id, 'embed']);
  expect(databases[0].prefixHeight).toBe(60);
  expect(databases[0].partCount).toBe(1);
  expect(slides.at(-1)?.blocks[0].text).toBe('After');
});
