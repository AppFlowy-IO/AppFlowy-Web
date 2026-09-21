/** @jest-environment node */
import { createHash } from 'node:crypto';

import { v5 as uuidv5 } from 'uuid';
import * as Y from 'yjs';

import { assertGitBlob, assertMarkdownMatchesCollab } from './github-sync-content-verifier';

type FixtureBlock = {
  kind: string;
  properties?: Record<string, unknown>;
  text?: Array<{ text: string; marks?: Record<string, unknown> }>;
  children?: FixtureBlock[];
};

// Handwritten persisted representation: neither the application importer nor the oracle builds it.
const markdown =
  '# Heading\n\nText **bold**, *italic*, ~~removed~~, `code`, and [link](https://example.com).  \nNew line.\n\n> Quote **content**\n>\n> Second paragraph.\n\n3. First\n4. Second\n   - Nested\n\n- [x] Done\n- [ ] Pending\n\n```sh\necho hello\n  indented\n```\n\n| Left | Right |\n| :--- | ---: |\n| **cell** | value |\n\n---\n\n![Alt](https://example.com/image.png "Caption")\n\n[Reference][target]\n\n[target]: https://example.com/reference\n';
const paragraph = (text: string): FixtureBlock => ({ kind: 'paragraph', text: [{ text }] });
const fixture: FixtureBlock[] = [
  { kind: 'heading', properties: { level: 1 }, text: [{ text: 'Heading' }] },
  {
    kind: 'paragraph',
    text: [
      { text: 'Text ' },
      { text: 'bold', marks: { bold: true } },
      { text: ', ' },
      { text: 'italic', marks: { italic: true } },
      { text: ', ' },
      { text: 'removed', marks: { strikethrough: true } },
      { text: ', ' },
      { text: 'code', marks: { code: true } },
      { text: ', and ' },
      { text: 'link', marks: { href: 'https://example.com' } },
      { text: '.\nNew line.' },
    ],
  },
  {
    kind: 'quote',
    text: [{ text: 'Quote ' }, { text: 'content', marks: { bold: true } }],
    children: [paragraph('Second paragraph.')],
  },
  { kind: 'numbered_list', properties: { number: 3 }, text: [{ text: 'First' }] },
  {
    kind: 'numbered_list',
    properties: { number: 3 },
    text: [{ text: 'Second' }],
    children: [{ kind: 'bulleted_list', text: [{ text: 'Nested' }] }],
  },
  { kind: 'todo_list', properties: { checked: true }, text: [{ text: 'Done' }] },
  { kind: 'todo_list', properties: { checked: false }, text: [{ text: 'Pending' }] },
  { kind: 'code', properties: { language: 'bash' }, text: [{ text: 'echo hello\n  indented' }] },
  {
    kind: 'simple_table',
    children: [
      {
        kind: 'simple_table_row',
        children: [
          {
            kind: 'simple_table_cell',
            properties: { rowPosition: 0, colPosition: 0, align: 'left' },
            children: [paragraph('Left')],
          },
          {
            kind: 'simple_table_cell',
            properties: { rowPosition: 0, colPosition: 1, align: 'right' },
            children: [paragraph('Right')],
          },
        ],
      },
      {
        kind: 'simple_table_row',
        children: [
          {
            kind: 'simple_table_cell',
            properties: { rowPosition: 1, colPosition: 0, align: 'left' },
            children: [{ kind: 'paragraph', text: [{ text: 'cell', marks: { bold: true } }] }],
          },
          {
            kind: 'simple_table_cell',
            properties: { rowPosition: 1, colPosition: 1, align: 'right' },
            children: [paragraph('value')],
          },
        ],
      },
    ],
  },
  { kind: 'divider' },
  { kind: 'image', properties: { image_type: 2, url: 'https://example.com/image.png', alt: 'Alt', title: 'Caption' } },
  { kind: 'paragraph', text: [{ text: 'Reference', marks: { href: 'https://example.com/reference' } }] },
];

function encode(blocks: FixtureBlock[], change?: (doc: Y.Doc) => void, headingId?: string): Uint8Array {
  const doc = new Y.Doc();
  const document = new Y.Map<unknown>();
  const storedBlocks = new Y.Map<Y.Map<unknown>>();
  const meta = new Y.Map<unknown>();
  const childMap = new Y.Map<Y.Array<string>>();
  const textMap = new Y.Map<Y.Text>();

  doc.getMap('data').set('document', document);
  document.set('page_id', 'root');
  document.set('blocks', storedBlocks);
  document.set('meta', meta);
  meta.set('children_map', childMap);
  meta.set('text_map', textMap);
  let index = 0;
  const add = (item: FixtureBlock, parent: string): string => {
    const id = item.kind === 'page' ? 'root' : item.kind === 'heading' && headingId ? headingId : `block-${index++}`;
    const stored = new Y.Map<unknown>();

    storedBlocks.set(id, stored);
    stored.set('id', id);
    stored.set('parent', parent);
    stored.set('ty', item.kind);
    stored.set('data', JSON.stringify(item.properties ?? {}));
    stored.set('children', `children:${id}`);
    if (item.text) {
      const text = new Y.Text();

      textMap.set(`text:${id}`, text);
      stored.set('external_id', `text:${id}`);
      stored.set('external_type', 'text');
      for (const run of item.text) text.insert(text.length, run.text, run.marks ?? {});
    }

    const children = new Y.Array<string>();

    childMap.set(`children:${id}`, children);
    children.push((item.children ?? []).map((child) => add(child, id)));
    return id;
  };

  add({ kind: 'page', children: blocks }, '');
  change?.(doc);
  const encoded = Y.encodeStateAsUpdate(doc);

  doc.destroy();
  return encoded;
}

const copy = () => JSON.parse(JSON.stringify(fixture)) as FixtureBlock[];
const check = (blocks: FixtureBlock[]) => assertMarkdownMatchesCollab('docs/test.md', markdown, encode(blocks));

describe('GitHub source versus persisted document oracle', () => {
  it('compares complete nested content, marks, references, tables, code and images', () => {
    expect(check(copy())).toEqual({ blocks: 24, images: 1 });
  });

  it.each(['bold', 'italic', 'strikethrough', 'code', 'href'])('rejects a lost %s mark', (mark) => {
    const blocks = copy();
    const run = blocks[1].text!.find((item) => item.marks?.[mark]);

    delete run!.marks![mark];
    expect(() => check(blocks)).toThrow('ordered text or formatting differs');
  });

  it('rejects deleted/changed text and reordered or duplicated blocks', () => {
    for (const value of ['', 'corruption']) {
      const blocks = copy();

      blocks[1].text![1].text = value;
      expect(() => check(blocks)).toThrow('ordered text or formatting differs');
    }

    const reordered = copy();

    [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
    expect(() => check(reordered)).toThrow('block kind differs');
    expect(() => check([...copy(), paragraph('extra')])).toThrow('child count differs');
  });

  it('rejects loss of duplicated source text that substring assertions cannot detect', () => {
    expect(() => assertMarkdownMatchesCollab('repeat.md', 'Same.\n\nSame.', encode([paragraph('Same.')]))).toThrow(
      'child count differs'
    );
  });

  it.each([
    (blocks: FixtureBlock[]) => {
      blocks[0].properties!.level = 2;
    },
    (blocks: FixtureBlock[]) => {
      blocks[7].properties!.language = 'python';
    },
    (blocks: FixtureBlock[]) => {
      blocks[7].text![0].text = 'echo hello\nindented';
    },
    (blocks: FixtureBlock[]) => {
      blocks[5].properties!.checked = false;
    },
    (blocks: FixtureBlock[]) => {
      blocks[3].properties!.number = 1;
    },
    (blocks: FixtureBlock[]) => {
      blocks[8].children![0].children![1].properties!.align = 'left';
    },
    (blocks: FixtureBlock[]) => {
      blocks[10].properties!.url = 'https://wrong.example/image.png';
    },
    (blocks: FixtureBlock[]) => {
      blocks[10].properties!.alt = 'Wrong';
    },
    (blocks: FixtureBlock[]) => {
      blocks[1].text![9].marks!.href = 'https://wrong.example';
    },
    (blocks: FixtureBlock[]) => {
      blocks[4].children = [];
    },
  ])('rejects structural or metadata corruption %#', (mutate) => {
    const blocks = copy();

    mutate(blocks);
    expect(() => check(blocks)).toThrow();
  });

  it('compares rewritten links/images and standalone image lines between paragraph text', () => {
    const source = 'Before\n![alt](images/a.png)\nAfter [next](next.md).';
    const image = 'https://app.example/blob/a.png';
    const link = 'https://app.example/app/workspace/view';
    const blocks: FixtureBlock[] = [
      paragraph('Before'),
      { kind: 'image', properties: { image_type: 2, url: image, alt: 'alt' } },
      {
        kind: 'paragraph',
        text: [{ text: 'After ' }, { text: 'next', marks: { href: link } }, { text: '.' }],
      },
    ];

    expect(
      assertMarkdownMatchesCollab('images.md', source, encode(blocks), {
        links: new Map([['next.md', link]]),
        images: new Map([['images/a.png', image]]),
      })
    ).toEqual({ blocks: 3, images: 1 });
  });

  it('validates heading anchor identities and parent/tree integrity', () => {
    const view = '11111111-1111-4111-8111-111111111111';
    const source = '# Heading';
    const block = [fixture[0]];

    expect(() => assertMarkdownMatchesCollab('heading.md', source, encode(block), {}, view)).toThrow(
      'heading target ID differs'
    );
    expect(
      assertMarkdownMatchesCollab(
        'heading.md',
        source,
        encode(block, undefined, uuidv5('heading:heading', view)),
        {},
        view
      ).blocks
    ).toBe(1);
    const invalid = encode(block, (doc) => {
      const document = doc.getMap('data').get('document') as Y.Map<unknown>;
      const blocks = document.get('blocks') as Y.Map<Y.Map<unknown>>;

      blocks.get('block-0')!.set('parent', 'wrong');
    });

    expect(() => assertMarkdownMatchesCollab('heading.md', source, invalid)).toThrow('inconsistent parent');
  });

  it('validates Git blob hashes and rejects changed bytes, even with equal byte lengths', () => {
    const original = Buffer.from('# Original\n');
    const sha = createHash('sha1').update(`blob ${original.length}\0`).update(original).digest('hex');

    expect(() => assertGitBlob(original, sha, 'a.md')).not.toThrow();
    expect(() => assertGitBlob(Buffer.from('# Modified\n'), sha, 'a.md')).toThrow('pinned raw bytes differ');
  });
});
