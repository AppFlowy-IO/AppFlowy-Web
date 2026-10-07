import { createEditor, Editor, Element, type Text } from 'slate';
import { ReactEditor, withReact } from 'slate-react';

import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { CustomEditor } from '@/application/slate-yjs/command';
import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, MentionType, YjsEditorKey } from '@/application/types';
import type { SimpleTableNode } from '@/components/editor/editor.type';
import { withPlugins } from '@/components/editor/plugins';
import { convertSlateFragmentTo } from '@/components/editor/utils/fragment';

import { deleteBlocksWithSimpleTable, deleteSimpleTable, simpleTableCsv, simpleTableTextRows } from '../SimpleTable.convert';

jest.mock('@/components/editor/parsers/html-parser', () => ({ parseHTML: jest.fn() }));
jest.mock('@/components/editor/parsers/markdown-parser', () => ({ parseMarkdown: jest.fn() }));

function inlineTable(): SimpleTableNode {
  const values: Text[] = [
    { text: '@', mention: { type: MentionType.Person, person_id: 'ada', person_name: 'Ada Lovelace' } },
    { text: '@', mention: { type: MentionType.Date, date: '2026-09-10T00:00:00Z' } },
    { text: '@', mention: { type: MentionType.PageRef, page_id: 'page', data: { title: 'Launch "checklist"' } } },
    { text: '$', formula: 'x^2 + y^2' },
  ];

  return {
    type: BlockType.SimpleTableBlock, blockId: 'table', data: {},
    children: [{
      type: BlockType.SimpleTableRowBlock, blockId: 'row', data: {},
      children: values.map((value, index) => ({
        type: BlockType.SimpleTableCellBlock, blockId: `cell-${index}`, data: {},
        children: [{
          type: BlockType.Paragraph, blockId: `paragraph-${index}`, data: {},
          children: [{ type: YjsEditorKey.text, children: [value] }],
        }],
      })),
    }],
  } as SimpleTableNode;
}

function seededEditor(types: BlockType[]) {
  const doc = withTestingYDoc('page');
  const base = withYHistory(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local }));
  const editor = withPlugins(withReact(base)) as typeof base;
  const blockIds = types.map((type, index) => {
    if (type === BlockType.SimpleTableBlock) return CustomEditor.createSimpleTable(editor, 'page', 2, 2)!;
    return slateContentInsertToYData('page', index, convertSlateFragmentTo([{
      type, data: {}, children: [{ type: YjsEditorKey.text, children: [{ text: 'Keep me' }] }],
    } as Element]), doc)[0];
  });

  editor.connect();
  editor.undoManager.clear();
  return { editor, blockIds };
}

describe('Simple table conversion content', () => {
  it('extracts names, dates, page titles, and formulas instead of inline placeholders', () => {
    expect(simpleTableTextRows(inlineTable())).toEqual([[
      'Ada Lovelace', 'Sep 10, 2026', 'Launch "checklist"', 'x^2 + y^2',
    ]]);
  });

  it('preserves the displayed inline values and escapes quotes in the database import CSV', () => {
    expect(simpleTableCsv(inlineTable())).toBe(
      '"Column 1","Column 2","Column 3","Column 4"\r\n"Ada Lovelace","Sep 10, 2026","Launch ""checklist""","x^2 + y^2"'
    );
  });
});

describe('Simple table deletion history and focus', () => {
  beforeEach(() => jest.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('focuses the replacement paragraph after deleting the only table and restores the table in one undo', () => {
    const { editor, blockIds } = seededEditor([BlockType.SimpleTableBlock]);
    const original = JSON.parse(JSON.stringify(editor.children));

    try {
      deleteSimpleTable(editor, blockIds[0]);
      expect(editor.children).toHaveLength(1);
      expect(editor.children[0]).toMatchObject({ type: BlockType.Paragraph });
      expect(editor.selection?.anchor).toEqual(editor.start([0]));
      expect(ReactEditor.focus).toHaveBeenCalledWith(editor);
      expect(editor.undoManager.undoStack).toHaveLength(1);
      editor.undo();
      expect(editor.children).toEqual(original);
      editor.redo();
      expect(editor.children[0]).toMatchObject({ type: BlockType.Paragraph });
    } finally {
      editor.disconnect();
    }
  });

  it('focuses a real paragraph inside a surviving table rather than its structural text', () => {
    const { editor, blockIds } = seededEditor([BlockType.SimpleTableBlock, BlockType.SimpleTableBlock]);

    try {
      deleteSimpleTable(editor, blockIds[0]);
      expect(editor.children).toHaveLength(1);
      expect(editor.children[0]).toMatchObject({ blockId: blockIds[1] });
      const paragraph = Editor.above(editor, {
        at: editor.selection!, match: (node) => Element.isElement(node) && node.type === BlockType.Paragraph,
      });

      expect(paragraph).toBeDefined();
      expect(ReactEditor.focus).toHaveBeenCalledWith(editor);
    } finally {
      editor.disconnect();
    }
  });

  it('restores blocks in document order when the table was inserted before an older paragraph', () => {
    const { editor, blockIds } = seededEditor([BlockType.Paragraph]);
    const tableId = CustomEditor.createSimpleTable(editor, 'page', 2, 2, 0)!;
    const original = JSON.parse(JSON.stringify(editor.children));

    editor.undoManager.clear();
    try {
      deleteBlocksWithSimpleTable(editor, [tableId, ...blockIds]);
      expect(editor.undoManager.undoStack).toHaveLength(1);
      editor.undo();
      expect(editor.children).toEqual(original);
      editor.redo();
      expect(editor.children).toHaveLength(1);
      expect(editor.children[0]).toMatchObject({ type: BlockType.Paragraph });
    } finally {
      editor.disconnect();
    }
  });

  it.each([
    [BlockType.SimpleTableBlock, BlockType.Paragraph],
    [BlockType.SimpleTableBlock, BlockType.Paragraph, BlockType.Paragraph],
    [BlockType.Paragraph, BlockType.SimpleTableBlock, BlockType.Paragraph],
  ])('leaves a focused empty paragraph when the entire mixed selection is deleted (selection %j)', (...types) => {
    const { editor, blockIds } = seededEditor(types);
    const original = JSON.parse(JSON.stringify(editor.children));

    try {
      deleteBlocksWithSimpleTable(editor, blockIds);
      expect(editor.children).toHaveLength(1);
      expect(editor.children[0]).toMatchObject({ type: BlockType.Paragraph });
      expect(Editor.string(editor, [0])).toBe('');
      expect(editor.selection?.anchor).toEqual(editor.start([0]));
      expect(editor.undoManager.undoStack).toHaveLength(1);
      editor.undo();
      expect(editor.children).toEqual(original);
    } finally {
      editor.disconnect();
    }
  });

  it.each([
    [BlockType.SimpleTableBlock, BlockType.Paragraph],
    [BlockType.Paragraph, BlockType.SimpleTableBlock],
    [BlockType.SimpleTableBlock, BlockType.SimpleTableBlock, BlockType.Paragraph],
  ])('restores every block in a mixed deletion with one undo (selection %j)', (...selectedTypes) => {
    const { editor, blockIds } = seededEditor([...selectedTypes, BlockType.Paragraph]);
    const original = JSON.parse(JSON.stringify(editor.children));

    try {
      deleteBlocksWithSimpleTable(editor, blockIds.slice(0, -1));
      expect(editor.children).toHaveLength(1);
      expect(editor.children[0]).toMatchObject({ blockId: blockIds[blockIds.length - 1] });
      expect(editor.undoManager.undoStack).toHaveLength(1);
      editor.undo();
      expect(editor.children).toEqual(original);
      editor.redo();
      expect(editor.children).toHaveLength(1);
    } finally {
      editor.disconnect();
    }
  });
});
