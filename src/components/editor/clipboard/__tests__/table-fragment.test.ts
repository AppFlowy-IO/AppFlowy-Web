import { Element } from 'slate';

import { BlockType, YjsEditorKey } from '@/application/types';

import { appFlowyDocumentToSlateFragment } from '../appflowy-fragment';
import { containsSimpleTableBlocks, extractTSVFromTableFragment } from '../table-fragment';

describe('table clipboard fragment helpers', () => {
  it('extracts TSV from desktop table fragments without counting text wrappers as rows or cells', () => {
    const fragment = appFlowyDocumentToSlateFragment({
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
    });

    expect(fragment).not.toBeNull();
    expect(extractTSVFromTableFragment(fragment ?? [])).toBe('A1\tB1');
  });

  it('extracts TSV from row and cell fragments', () => {
    const row = {
      type: BlockType.SimpleTableRowBlock,
      data: {},
      children: [
        {
          type: YjsEditorKey.text,
          children: [{ text: '' }],
        },
        createCell('A1'),
        createCell('B1'),
      ],
    } as Element;

    expect(extractTSVFromTableFragment([row])).toBe('A1\tB1');
    expect(extractTSVFromTableFragment([createCell('A1')])).toBe('A1');
  });

  it('detects table blocks nested under another element', () => {
    const fragment = [
      {
        type: BlockType.ColumnsBlock,
        data: {},
        children: [
          {
            type: YjsEditorKey.text,
            children: [{ text: '' }],
          },
          {
            type: BlockType.SimpleTableCellBlock,
            data: {},
            children: [
              {
                type: YjsEditorKey.text,
                children: [{ text: '' }],
              },
            ],
          },
        ],
      },
    ] as Element[];

    expect(containsSimpleTableBlocks(fragment)).toBe(true);
  });
});

function createCell(text: string): Element {
  return {
    type: BlockType.SimpleTableCellBlock,
    data: {},
    children: [
      {
        type: YjsEditorKey.text,
        children: [{ text: '' }],
      },
      {
        type: BlockType.Paragraph,
        data: {},
        children: [
          {
            type: YjsEditorKey.text,
            children: [{ text }],
          },
        ],
      },
    ],
  } as Element;
}
