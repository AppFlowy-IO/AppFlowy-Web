import { resolveMapReferences } from '../mindmap-references';

import type { MindMap, MindMapImport, PageSnapshot, SourceBlock } from '../types';

const block = (id: string, text: string, children: SourceBlock[] = [], type = 'paragraph'): SourceBlock => ({
  id,
  type,
  text,
  children,
});
const snapshot: PageSnapshot = {
  pageId: 'document',
  title: 'Training report',
  revision: 'current',
  kind: 'document',
  properties: [],
  warnings: [],
  blocks: [
    block('intro', 'Training has evolved.'),
    block(
      'table',
      '',
      [
        block(
          'row',
          '',
          [
            block('cell-subject', '', [block('subject', 'Pretraining')], 'simple_table_cell'),
            block('cell-before', '', [block('before', 'Large-scale web text')], 'simple_table_cell'),
            block('cell-after', '', [block('after', 'Curated, multilingual data')], 'simple_table_cell'),
          ],
          'simple_table_row'
        ),
      ],
      'simple_table'
    ),
    block('link', 'See the research paper.'),
    block('repeated-1', 'Repeated passage'),
    block('repeated-2', 'Repeated passage'),
  ],
};
const imported: MindMapImport = {
  fileName: 'article.json',
  importedAt: '2026-10-23T00:00:00Z',
  referenceKind: 'external',
  sourceQuotes: {
    L1: '# 1. Training report',
    L4: '**Training** has evolved.',
    L53: '| Pretraining | Large-scale web text | Curated, multilingual data |',
    L80: 'See the [research paper](https://example.org/paper).',
    L90: 'Repeated passage',
    L91: 'A passage that was removed.',
  },
};
const map: MindMap = {
  warnings: [],
  nodes: [
    {
      id: 'root',
      parentId: null,
      label: 'Report',
      summary: '',
      sourceIds: [...Object.keys(imported.sourceQuotes!), 'intro'],
    },
  ],
};

it('resolves article quotes to live blocks, table rows, and page titles without changing the AI tree', () => {
  const before = JSON.stringify(map);

  expect(Object.fromEntries(resolveMapReferences(map, snapshot, imported))).toEqual({
    L1: 'document',
    L4: 'intro',
    L53: 'row',
    L80: 'link',
    intro: 'intro',
  });
  expect(JSON.stringify(map)).toBe(before);
});

it('survives inserted blocks and new IDs instead of treating line references as positions', () => {
  const updated = { ...snapshot, blocks: [block('added', 'New content'), block('new-intro', 'Training has evolved.')] };

  expect(resolveMapReferences(map, updated, imported).get('L4')).toBe('new-intro');
  expect(resolveMapReferences(map, updated, imported).has('L53')).toBe(false);
});

it('does not guess missing, duplicate, or unmapped references from nearby or similar text', () => {
  const resolved = resolveMapReferences(map, snapshot, imported);

  expect(resolved.has('L90')).toBe(false);
  expect(resolved.has('L91')).toBe(false);
  expect(resolveMapReferences(map, snapshot).has('L53')).toBe(false);
  expect(resolveMapReferences(map, snapshot).get('intro')).toBe('intro');
});

test('uses the complete canonical server reference registry without inferring native IDs or imported quotes', () => {
  const source = {
    ...snapshot,
    serverSource: {
      references: {
        'page:canonical': { location: { kind: 'document', pageId: snapshot.pageId, blockId: null } },
        'media:canonical': { location: { kind: 'media', pageId: snapshot.pageId, assetId: 'image' } },
      },
    },
  } as PageSnapshot;
  const map = {
    schemaVersion: 1,
    warnings: [],
    nodes: [
      {
        id: 'root',
        parentId: null,
        label: snapshot.title,
        summary: '',
        sourceIds: ['page:canonical', 'media:canonical', 'intro', 'L4'],
      },
    ],
  } as MindMap;

  expect([...resolveMapReferences(map, source, imported)]).toEqual([
    ['page:canonical', 'page:canonical'],
    ['media:canonical', 'media:canonical'],
  ]);
});
