import { Element } from 'slate';

import { BlockType, YjsEditorKey } from '@/application/types';

import {
  APPFLOWY_FRAGMENT_MIME,
  appFlowyDocumentToSlateFragment,
  clipboardPayloadToSlateFragment,
  extractAppFlowyClipboardFragment,
} from '../appflowy-fragment';

function createClipboardData(data: Record<string, string>): Pick<DataTransfer, 'getData'> {
  return {
    getData: jest.fn((type: string) => data[type] ?? ''),
  };
}

function encodeWebFragment(payload: unknown): string {
  return Buffer.from(encodeURIComponent(JSON.stringify(payload))).toString('base64');
}

function encodeDesktopCarrier(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function textChildren(node: Element) {
  return ((node.children[0] as Element).children ?? []) as Array<Record<string, unknown>>;
}

describe('AppFlowy clipboard fragment paste support', () => {
  const desktopDocument = {
    document: {
      type: BlockType.Page,
      children: [
        {
          type: BlockType.HeadingBlock,
          data: {
            level: 2,
            delta: [{ insert: 'Roadmap', attributes: { bold: true } }],
          },
          children: [],
        },
        {
          type: BlockType.Paragraph,
          data: {
            align: 'center',
            delta: [
              { insert: 'Visit ' },
              { insert: 'AppFlowy', attributes: { href: 'https://appflowy.io', italic: true } },
            ],
          },
          children: [],
        },
        {
          type: BlockType.BulletedListBlock,
          data: {
            delta: [{ insert: 'Parent' }],
          },
          children: [
            {
              type: BlockType.BulletedListBlock,
              data: {
                delta: [{ insert: 'Child', attributes: { underline: true } }],
              },
              children: [],
            },
          ],
        },
      ],
    },
  };

  it('converts desktop document JSON into Slate blocks without losing rich text data', () => {
    const fragment = appFlowyDocumentToSlateFragment(desktopDocument);

    expect(fragment).toHaveLength(3);

    const heading = fragment?.[0] as Element;
    const paragraph = fragment?.[1] as Element;
    const list = fragment?.[2] as Element;

    expect(heading).toMatchObject({
      type: BlockType.HeadingBlock,
      data: { level: 2 },
      children: [
        {
          type: YjsEditorKey.text,
          children: [{ text: 'Roadmap', bold: true }],
        },
      ],
    });
    expect(heading.data).not.toHaveProperty(YjsEditorKey.delta);

    expect(paragraph.data).toEqual({ align: 'center' });
    expect(textChildren(paragraph)).toEqual([
      { text: 'Visit ' },
      { text: 'AppFlowy', href: 'https://appflowy.io', italic: true },
    ]);

    expect(list.children[1]).toMatchObject({
      type: BlockType.BulletedListBlock,
      children: [
        {
          type: YjsEditorKey.text,
          children: [{ text: 'Child', underline: true }],
        },
      ],
    });
  });

  it('preserves simple table structure from desktop JSON', () => {
    const tableDocument = {
      document: {
        type: BlockType.Page,
        children: [
          {
            type: BlockType.SimpleTableBlock,
            data: {},
            children: [
              {
                type: BlockType.SimpleTableRowBlock,
                data: {},
                children: [
                  {
                    type: BlockType.SimpleTableCellBlock,
                    data: {},
                    children: [
                      {
                        type: BlockType.Paragraph,
                        data: { delta: [{ insert: 'A1' }] },
                        children: [],
                      },
                    ],
                  },
                  {
                    type: BlockType.SimpleTableCellBlock,
                    data: {},
                    children: [
                      {
                        type: BlockType.Paragraph,
                        data: { delta: [{ insert: 'B1' }] },
                        children: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const fragment = appFlowyDocumentToSlateFragment(tableDocument);
    const table = fragment?.[0] as Element;
    const row = table.children[1] as Element;
    const firstCell = row.children[1] as Element;
    const firstParagraph = firstCell.children[1] as Element;

    expect(table.type).toBe(BlockType.SimpleTableBlock);
    expect((table.children[0] as Element).type).toBe(YjsEditorKey.text);
    expect(row.type).toBe(BlockType.SimpleTableRowBlock);
    expect(firstCell.type).toBe(BlockType.SimpleTableCellBlock);
    expect(textChildren(firstParagraph)).toEqual([{ text: 'A1' }]);
  });

  it('reads web AppFlowy MIME fragments before fallback formats', () => {
    const appFlowyFragment = [
      {
        type: BlockType.Paragraph,
        data: {},
        children: [{ type: YjsEditorKey.text, children: [{ text: 'Native fragment' }] }],
      },
    ];
    const jsonFallback = JSON.stringify({
      document: {
        type: BlockType.Page,
        children: [
          {
            type: BlockType.Paragraph,
            data: { delta: [{ insert: 'JSON fallback' }] },
            children: [],
          },
        ],
      },
    });

    const result = extractAppFlowyClipboardFragment(
      createClipboardData({
        [APPFLOWY_FRAGMENT_MIME]: encodeWebFragment(appFlowyFragment),
        'application/json': jsonFallback,
      })
    );

    expect(result?.source).toBe(APPFLOWY_FRAGMENT_MIME);
    expect(textChildren(result?.fragment[0] as Element)).toEqual([{ text: 'Native fragment' }]);
  });

  it('reads Flutter desktop private in-app JSON', () => {
    const result = extractAppFlowyClipboardFragment(
      createClipboardData({
        'io.appflowy.InAppJsonType': JSON.stringify(desktopDocument),
      })
    );

    expect(result?.source).toBe('io.appflowy.InAppJsonType');
    expect((result?.fragment[0] as Element).type).toBe(BlockType.HeadingBlock);
    expect(textChildren(result?.fragment[0] as Element)).toEqual([{ text: 'Roadmap', bold: true }]);
  });

  it('reads desktop private MIME aliases from non-macOS clipboard bridges', () => {
    const result = extractAppFlowyClipboardFragment(
      createClipboardData({
        'application/x-private;appId=io.appflowy.InAppJsonType': JSON.stringify(desktopDocument),
      })
    );

    expect(result?.source).toBe('application/x-private;appId=io.appflowy.InAppJsonType');
    expect((result?.fragment[2] as Element).type).toBe(BlockType.BulletedListBlock);
    expect(textChildren(result?.fragment[2] as Element)).toEqual([{ text: 'Parent' }]);
  });

  it('reads desktop table JSON fragments from the table-specific format', () => {
    const tableFragment = [
      {
        type: BlockType.SimpleTableCellBlock,
        data: {},
        children: [
          {
            type: BlockType.Paragraph,
            data: { delta: [{ insert: 'Cell text' }] },
            children: [],
          },
        ],
      },
    ];

    const result = extractAppFlowyClipboardFragment(
      createClipboardData({
        'io.appflowy.TableJsonType': JSON.stringify(tableFragment),
      })
    );

    const cell = result?.fragment[0] as Element;
    const paragraph = cell.children[1] as Element;

    expect(result?.source).toBe('io.appflowy.TableJsonType');
    expect(cell.type).toBe(BlockType.SimpleTableCellBlock);
    expect(textChildren(paragraph)).toEqual([{ text: 'Cell text' }]);
  });

  it('reads validated AppFlowy document JSON from application/json', () => {
    const result = extractAppFlowyClipboardFragment(
      createClipboardData({
        'application/json': JSON.stringify(desktopDocument),
      })
    );

    expect(result?.source).toBe('application/json');
    expect((result?.fragment[0] as Element).type).toBe(BlockType.HeadingBlock);
  });

  it('reads the HTML carrier when custom clipboard MIME types are unavailable', () => {
    const result = extractAppFlowyClipboardFragment(
      createClipboardData({
        'text/html': `<meta data-appflowy-fragment="${encodeDesktopCarrier(desktopDocument)}"><p>Roadmap</p>`,
      })
    );

    expect(result?.source).toBe('text/html:data-appflowy-fragment');
    expect((result?.fragment[1] as Element).data).toEqual({ align: 'center' });
    expect(textChildren(result?.fragment[1] as Element)).toEqual([
      { text: 'Visit ' },
      { text: 'AppFlowy', href: 'https://appflowy.io', italic: true },
    ]);
  });

  it('preserves non-ASCII text from the desktop HTML carrier', () => {
    const result = extractAppFlowyClipboardFragment(
      createClipboardData({
        'text/html': `<span data-appflowy-fragment="${encodeDesktopCarrier({
          document: {
            type: BlockType.Page,
            children: [
              {
                type: BlockType.Paragraph,
                data: {
                  delta: [{ insert: '你好 AppFlowy' }],
                },
                children: [],
              },
            ],
          },
        })}"></span>`,
      })
    );

    expect(textChildren(result?.fragment[0] as Element)).toEqual([{ text: '你好 AppFlowy' }]);
  });

  it('ignores unrelated JSON clipboard data so HTML/plain paste can handle it', () => {
    const result = extractAppFlowyClipboardFragment(
      createClipboardData({
        'application/json': JSON.stringify({ type: 'not-appflowy', value: 42 }),
      })
    );

    expect(result).toBeNull();
  });

  it('ignores raw AppFlowy-like blocks in generic application/json', () => {
    const result = extractAppFlowyClipboardFragment(
      createClipboardData({
        'application/json': JSON.stringify({
          type: BlockType.Paragraph,
          data: { delta: [{ insert: 'Looks like a block' }] },
          children: [],
        }),
      })
    );

    expect(result).toBeNull();
  });

  it('normalizes valid web fragments that have empty block children', () => {
    const fragment = clipboardPayloadToSlateFragment(
      encodeWebFragment([
        {
          type: BlockType.DividerBlock,
          data: {},
          children: [],
        },
      ])
    );

    expect(fragment).toEqual([
      {
        type: BlockType.DividerBlock,
        data: {},
        children: [
          {
            type: YjsEditorKey.text,
            children: [{ text: '' }],
          },
        ],
      },
    ]);
  });
});
