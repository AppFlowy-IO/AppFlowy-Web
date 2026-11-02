import type { Element } from 'slate';

import { CoverType } from '@/application/types';

import { snapshotFromSlate } from '../snapshot-adapter';
import { paginateDocument } from '../document-pagination';
import { splitDocument } from '../source';

beforeAll(() => {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
});

it('freezes the page cover and includes cover changes in the source revision', () => {
  const cover = { type: CoverType.CustomImage, value: 'https://example.com/cover.jpg', offset: 0.6 };
  const snapshot = snapshotFromSlate('page', 'Document', undefined, false, undefined, cover);
  expect(snapshot.cover).toEqual(cover);
  cover.offset = -0.4;
  expect(snapshot.cover?.offset).toBe(0.6);
  expect(snapshotFromSlate('page', 'Document', undefined, false, undefined, cover).revision).not.toBe(snapshot.revision);
});

it('retains native inline objects, links, font marks and callout metadata without changing the source', () => {
  const mention = { type: 'page', page_id: 'guide', data: { title: 'Desktop guide' } };
  const leaves = [
    { text: '$', mention },
    {
      text: 'Quick start',
      href: 'https://appflowy.com',
      font_family: 'mono',
      font_color: 'text-color-1',
      bg_color: 'bg-color-10',
      bold: true,
    },
    { text: '$', formula: 'x^2' },
  ];
  const data = {
    icon: '⚠️',
    icon_type: 'emoji',
    version: 1,
    bgColor: 'appflowy_them_color_tint5',
    textColor: 'appflowy_them_color_tint13',
  };
  const content = {
    type: 'page',
    children: [
      { type: 'callout', data, children: [{ type: 'text', children: leaves }] },
      { type: 'linked_page', data: { view_id: 'guide' }, children: [{ text: '' }] },
    ],
  } as unknown as Element;
  const original = JSON.stringify(content);
  const blocks = snapshotFromSlate('page', 'Document', content).blocks;

  expect(blocks[0].richText).toEqual(leaves);
  expect(blocks[0].richText![0].mention).not.toBe(mention);
  expect(blocks[0].callout).toEqual(data);
  expect(blocks[0].callout).not.toBe(data);
  expect(blocks[1].pageId).toBe('guide');
  expect(JSON.stringify(content)).toBe(original);
});

it('preserves removed and legacy callout icons as distinct values', () => {
  const content = {
    type: 'page',
    children: [
      { type: 'callout', data: { version: 1, icon: '' }, children: [{ text: 'No icon' }] },
      { type: 'callout', data: { icon: '💡' }, children: [{ text: 'Legacy emoji' }] },
      { type: 'callout', data: {}, children: [{ text: 'Legacy default' }] },
    ],
  } as unknown as Element;
  const blocks = snapshotFromSlate('page', 'Document', content).blocks;
  expect(blocks[0].callout).toMatchObject({ version: 1, icon: '' });
  expect(blocks[1].callout).toMatchObject({ icon: '💡' });
  expect(blocks[2].callout?.version).toBeUndefined();
});

it('keeps sibling numbering and nested marker styles when a list crosses slides', () => {
  const content = {
    type: 'page',
    children: [
      {
        blockId: 'first',
        type: 'numbered_list',
        children: [{ text: 'First' }, { type: 'numbered_list', children: [{ text: 'Nested' }] }],
      },
      { blockId: 'second', type: 'numbered_list', children: [{ text: 'Second' }] },
      { blockId: 'third', type: 'numbered_list', children: [{ text: 'Third' }] },
      { type: 'paragraph', children: [{ text: 'Break' }] },
      { type: 'numbered_list', data: { number: 5 }, children: [{ text: 'Restart' }] },
      {
        type: 'bulleted_list',
        children: [{ text: 'Bullet' }, { type: 'bulleted_list', children: [{ text: 'Nested bullet' }] }],
      },
    ],
  } as unknown as Element;
  const snapshot = snapshotFromSlate('page', 'Document', content);
  expect(snapshot.blocks.map((block) => block.listMarker)).toEqual(['1.', '2.', '3.', undefined, '5.', 'disc']);
  expect(snapshot.blocks[0].children[0].listMarker).toBe('a.');
  expect(snapshot.blocks[5].children[0].listMarker).toBe('circle');
  const slides = paginateDocument(splitDocument(snapshot), { '1:0': 60, '1:1': 60, '1:2': 60 }, 100);
  expect(
    slides
      .flatMap((slide) => slide.blocks)
      .filter((block) => ['first', 'second', 'third'].includes(block.id))
      .map((block) => block.listMarker)
  ).toEqual(['1.', '2.', '3.']);
});
