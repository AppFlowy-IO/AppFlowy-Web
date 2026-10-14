import { createEditor, Element, Node } from 'slate';
import { withReact } from 'slate-react';

import { withYjs, YjsEditor } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { CustomEditor } from '@/application/slate-yjs/command';
import { withYHistory, YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';
import { withInsertBreak } from '@/components/editor/plugins/withInsertBreak';

import { DEFAULT_CALLOUT_DATA } from '../callout.utils';

function block(type: BlockType, text: string, children: Element[] = [], data = {}): Element {
  return { type, data, children: [{ type: YjsEditorKey.text, children: [{ text }] }, ...children] } as Element;
}

jest.unmock('lodash-es/isEqual');
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), trace: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

// Ports document_callout_test.dart and callout cases in turn_into_test.dart.
describe('Flutter callout editing parity', () => {
  const editors: YjsEditor[] = [];
  function create(nodes: Element[], offset = 0) {
    const doc = withTestingYDoc('callout-page');

    slateContentInsertToYData('callout-page', 0, nodes, doc);
    const editor = withInsertBreak(
      withReact(withYHistory(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local })))
    ) as YjsEditor & YHistoryEditor;

    editor.connect();
    editor.select({ anchor: { path: [0, 0, 0], offset }, focus: { path: [0, 0, 0], offset } });
    editors.push(editor);
    return editor;
  }
  afterEach(() =>
    editors.splice(0).forEach((editor) => {
      editor.disconnect();
      editor.sharedRoot.doc?.destroy();
    })
  );

  it.each([0, 5, 11])('inserts a child paragraph at offset %i, preserving text and existing children', (offset) => {
    const editor = create(
      [
        block(
          BlockType.CalloutBlock,
          'Hello World',
          [block(BlockType.Paragraph, 'Existing child')],
          DEFAULT_CALLOUT_DATA
        ),
      ],
      offset
    );
    const id = (editor.children[0] as Element).blockId;

    editor.insertBreak();
    const callout = editor.children[0] as Element;

    expect(editor.children).toHaveLength(1);
    expect(callout).toMatchObject({ blockId: id, type: BlockType.CalloutBlock, data: DEFAULT_CALLOUT_DATA });
    expect(callout.children.map(Node.string)).toEqual([
      'Hello World'.slice(0, offset),
      'Hello World'.slice(offset),
      'Existing child',
    ]);
    expect((callout.children[1] as Element).type).toBe(BlockType.Paragraph);
    expect(editor.selection?.anchor).toEqual({ path: [0, 1, 0, 0], offset: 0 });
    editor.flushLocalChanges();
    expect(yDocToSlateContent(editor.sharedRoot.doc!)?.children).toEqual(editor.children);
    editor.undo();
    expect((editor.children[0] as Element).children.map(Node.string)).toEqual(['Hello World', 'Existing child']);
  });

  it('keeps an empty callout when Enter is pressed', () => {
    const editor = create([block(BlockType.CalloutBlock, '', [], DEFAULT_CALLOUT_DATA)]);

    editor.insertBreak();
    expect(editor.children[0]).toMatchObject({ type: BlockType.CalloutBlock });
    expect((editor.children[0] as Element).children.map(Node.string)).toEqual(['', '']);
  });

  it('replaces a selected range before inserting the child paragraph', () => {
    const editor = create([block(BlockType.CalloutBlock, 'Hello World', [], DEFAULT_CALLOUT_DATA)], 3);

    editor.select({ anchor: { path: [0, 0, 0], offset: 3 }, focus: { path: [0, 0, 0], offset: 8 } });
    editor.insertBreak();
    expect((editor.children[0] as Element).children.map(Node.string)).toEqual(['Hel', 'rld']);
  });

  it('Shift+Enter follows Flutter’s default soft break behavior', () => {
    const editor = create([block(BlockType.CalloutBlock, 'Hello World', [], DEFAULT_CALLOUT_DATA)], 5);

    editor.insertSoftBreak();
    expect(editor.children).toHaveLength(1);
    expect(editor.children[0]).toMatchObject({ type: BlockType.CalloutBlock });
    expect(Node.string(editor.children[0])).toBe('Hello\n World');
  });

  const types = [
    BlockType.Paragraph,
    BlockType.HeadingBlock,
    BlockType.BulletedListBlock,
    BlockType.NumberedListBlock,
    BlockType.TodoListBlock,
    BlockType.ToggleListBlock,
    BlockType.QuoteBlock,
    BlockType.CodeBlock,
  ];

  it.each(types)('converts callout to %s and back without losing text', (type) => {
    const editor = create([block(BlockType.CalloutBlock, 'callout', [], DEFAULT_CALLOUT_DATA)]);
    const id = (editor.children[0] as Element).blockId!;

    const convertedId = CustomEditor.turnToBlock(editor, id, type, {});

    expect(editor.children[0]).toMatchObject({ type });
    expect(Node.string(editor.children[0])).toBe('callout');
    CustomEditor.turnToBlock(editor, convertedId!, BlockType.CalloutBlock, DEFAULT_CALLOUT_DATA);
    expect(editor.children[0]).toMatchObject({ type: BlockType.CalloutBlock });
    expect(Node.string(editor.children[0])).toBe('callout');
  });

  it.each(types)('converts %s to callout while preserving text', (type) => {
    const editor = create([block(type, 'Original text')]);

    CustomEditor.turnToBlock(
      editor,
      (editor.children[0] as Element).blockId!,
      BlockType.CalloutBlock,
      DEFAULT_CALLOUT_DATA
    );
    expect(editor.children[0]).toMatchObject({ type: BlockType.CalloutBlock, data: DEFAULT_CALLOUT_DATA });
    expect(Node.string(editor.children[0])).toBe('Original text');
  });

  it('converts nested mixed lists into callouts without flattening their children', () => {
    const types = [BlockType.NumberedListBlock, BlockType.BulletedListBlock, BlockType.TodoListBlock];
    const editor = create(types.map((type, index) => block(type, `List ${index}`, [block(type, `Nested ${index}`)])));

    for (const node of [...editor.children] as Element[]) {
      CustomEditor.turnToBlock(editor, node.blockId!, BlockType.CalloutBlock, DEFAULT_CALLOUT_DATA);
    }
    expect(editor.children).toHaveLength(3);
    editor.children.forEach((node, index) => {
      expect(node).toMatchObject({ type: BlockType.CalloutBlock });
      expect((node as Element).children.map(Node.string)).toEqual([`List ${index}`, `Nested ${index}`]);
      expect((node as Element).children[1]).toMatchObject({ type: types[index] });
    });
  });
});
