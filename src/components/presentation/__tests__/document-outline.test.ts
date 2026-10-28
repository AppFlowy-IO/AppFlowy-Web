import type { Element } from 'slate';

import { documentOutline } from '../document-outline';
import { snapshotFromSlate } from '../snapshot-adapter';
import { splitDocument } from '../source';

beforeAll(() => {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
});

const block = (id: string, type: string, text: string, data = {}, children: Element[] = []) =>
  ({ blockId: id, type, data, children: [{ type: 'text', children: [{ text }] }, ...children] } as Element);

it('preserves outline settings and resolves heading labels using the native text reader', () => {
  const source = {
    type: 'page',
    children: [
      block('toc', 'outline', '', { depth: 2, bgColor: 'appflowy_them_color_tint5' }),
      {
        blockId: 'heading',
        type: 'heading',
        data: { level: 1 },
        children: [
          {
            type: 'text',
            children: [
              { text: '$', mention: { type: 'person', person_id: 'ada', person_name: 'Ada' } },
              { text: ' ' },
              { text: '$', formula: 'x^2' },
            ],
          },
        ],
      },
    ],
  } as Element;
  const before = JSON.stringify(source);
  const snapshot = snapshotFromSlate('page', 'Contents', source);
  expect(snapshot.blocks[0].outline).toEqual({ depth: 2, color: 'appflowy_them_color_tint5' });
  expect(snapshot.blocks[1].headingText).toBe('Ada x^2');
  expect(documentOutline(splitDocument(snapshot)).headings[0].data.text).toBe('Ada x^2');
  expect(JSON.stringify(source)).toBe(before);
});

it('indexes H1–H6 and toggle headings in document order with local ancestors and slide keys', () => {
  const source = {
    type: 'page',
    children: [
      block('toc', 'outline', ''),
      block('first', 'heading', 'First', { level: 1 }),
      block('outer', 'toggle_list', 'Outer', { collapsed: true }, [
        block('toggle-heading', 'toggle_list', 'Toggle heading', { level: 2, collapsed: true }, [
          block('nested', 'heading', 'Nested', { level: 6 }),
        ]),
      ]),
      block('invalid', 'heading', 'Invalid', { level: 7 }),
      block('ordinary', 'toggle_list', 'Ordinary toggle'),
    ],
  } as Element;
  const snapshot = snapshotFromSlate('page', 'Contents', source);
  const result = documentOutline(splitDocument(snapshot));
  expect(result.headings.map((heading) => heading.blockId)).toEqual(['first', 'toggle-heading', 'nested']);
  expect(result.targets.get('first')).toEqual({ key: '2:0', toggles: [] });
  expect(result.targets.get('toggle-heading')).toEqual({ key: '2:1', toggles: ['outer'] });
  expect(result.targets.get('nested')).toEqual({ key: '2:1', toggles: ['outer', 'toggle-heading'] });
  expect(snapshot.blocks[2].collapsed).toBe(true);
  expect(snapshot.blocks[2].children[0].collapsed).toBe(true);
});
