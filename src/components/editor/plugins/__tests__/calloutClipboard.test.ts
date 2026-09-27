import { createEditor, Element, Node } from 'slate';
import { withReact } from 'slate-react';

import { withYjs, YjsEditor } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { withYHistory, YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';
import { clipboardFormatKey } from '@/components/editor/plugins/withCopy';
import { withInsertData } from '@/components/editor/plugins/withInsertData';

function block(type: BlockType, text: string, children: Element[] = [], data = {}): Element {
  return {
    type,
    data,
    children: [{ type: YjsEditorKey.text, children: [{ text }] }, ...children],
  } as Element;
}

function clipboardData(nodes: Element[]): DataTransfer {
  return {
    files: [],
    getData: (type: string) =>
      type === 'application/x-appflowy-fragment' ? window.btoa(encodeURIComponent(JSON.stringify(nodes))) : '',
  } as unknown as DataTransfer;
}

describe('paste inside a callout', () => {
  const editors: YjsEditor[] = [];

  afterEach(() => {
    for (const editor of editors.splice(0)) {
      editor.disconnect();
      editor.sharedRoot.doc?.destroy();
    }
  });

  function createPasteEditor(container: Element, start = 0, end = start) {
    const doc = withTestingYDoc('callout-page');

    slateContentInsertToYData('callout-page', 0, [container, block(BlockType.Paragraph, 'Following paragraph')], doc);

    const editor = withInsertData(
      withReact(
        withYHistory(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local })),
        clipboardFormatKey
      )
    ) as YjsEditor & YHistoryEditor;

    editor.connect();
    editor.select({ anchor: { path: [0, 0, 0], offset: start }, focus: { path: [0, 0, 0], offset: end } });
    editors.push(editor);
    return editor;
  }

  it.each([BlockType.CalloutBlock, BlockType.QuoteBlock, BlockType.ToggleListBlock])(
    'keeps multiline text inside an empty expanded %s, preserving its identity and data',
    (type) => {
      const editor = createPasteEditor(block(type, '', [], { icon: '📌', bgColor: 'test-color', collapsed: false }));
      const original = editor.children[0] as Element;

      editor.insertData(
        clipboardData([block(BlockType.Paragraph, 'First line'), block(BlockType.Paragraph, 'Second line')])
      );

      expect(editor.children).toHaveLength(2);
      expect(editor.children[0]).toMatchObject({ blockId: original.blockId, type, data: original.data });
      const container = editor.children[0] as Element;

      expect(container.children.map(Node.string)).toEqual(['First line', 'Second line']);
      expect(editor.selection?.anchor).toEqual({ path: [0, 1, 0, 0], offset: 11 });
      editor.flushLocalChanges();
      expect(yDocToSlateContent(editor.sharedRoot.doc!)?.children).toEqual(editor.children);
    }
  );

  it.each([
    { type: BlockType.BulletedListBlock, data: {} },
    { type: BlockType.NumberedListBlock, data: { number: 3 } },
    { type: BlockType.TodoListBlock, data: { checked: true } },
    { type: BlockType.HeadingBlock, data: { level: 2 } },
  ])('preserves copied $type blocks and their data inside an empty callout', ({ type, data }) => {
    const editor = createPasteEditor(block(BlockType.CalloutBlock, ''));
    const originalId = (editor.children[0] as Element).blockId;
    const copied = [block(type, 'First item', [], data), block(type, 'Second item', [], data)];

    (copied[0].children[0] as Element).children = [{ text: 'First item', bold: true }];
    editor.insertData(clipboardData(copied));

    expect(editor.children).toHaveLength(2);
    const container = editor.children[0] as Element;

    expect(container).toMatchObject({ blockId: originalId, type: BlockType.CalloutBlock });
    expect(container.children.map(Node.string)).toEqual(['', 'First item', 'Second item']);
    expect(container.children.slice(1)).toMatchObject(copied);
    expect(editor.selection?.anchor).toEqual({ path: [0, 2, 0, 0], offset: 11 });
    editor.flushLocalChanges();
    expect(yDocToSlateContent(editor.sharedRoot.doc!)?.children).toEqual(editor.children);
  });

  it('preserves a copied checkbox before existing children when the callout first line is empty', () => {
    const editor = createPasteEditor(block(BlockType.CalloutBlock, '', [block(BlockType.Paragraph, 'Existing child')]));
    const copied = block(BlockType.TodoListBlock, 'Completed task', [], { checked: true });

    editor.insertData(clipboardData([copied]));

    const container = editor.children[0] as Element;

    expect(container.children.map(Node.string)).toEqual(['', 'Completed task', 'Existing child']);
    expect(container.children[1]).toMatchObject(copied);
  });

  it('continues to merge copied heading text at a caret inside populated callout text', () => {
    const editor = createPasteEditor(block(BlockType.CalloutBlock, 'Before after'), 7);

    editor.insertData(clipboardData([block(BlockType.HeadingBlock, 'Title', [], { level: 2 })]));

    expect((editor.children[0] as Element).children.map(Node.string)).toEqual(['Before Titleafter']);
    expect(editor.selection?.anchor).toEqual({ path: [0, 0, 0], offset: 12 });
  });

  it('replaces selected callout text, moves the trailing text after the paste, and preserves existing children', () => {
    const editor = createPasteEditor(
      block(BlockType.CalloutBlock, 'Before REPLACE after', [block(BlockType.Paragraph, 'Existing child')]),
      7,
      14
    );

    editor.insertData(clipboardData([block(BlockType.Paragraph, 'First'), block(BlockType.Paragraph, 'Last')]));

    expect(editor.children).toHaveLength(2);
    const container = editor.children[0] as Element;

    expect(container.children.map(Node.string)).toEqual(['Before First', 'Last after', 'Existing child']);
    expect(editor.selection?.anchor).toEqual({ path: [0, 1, 0, 0], offset: 4 });
  });

  it('keeps a pasted block with children inside the empty callout without flattening its structure', () => {
    const editor = createPasteEditor(block(BlockType.CalloutBlock, ''));

    editor.insertData(
      clipboardData([
        block(BlockType.BulletedListBlock, 'Parent item', [block(BlockType.BulletedListBlock, 'Nested item')]),
      ])
    );

    expect(editor.children).toHaveLength(2);
    const container = editor.children[0] as Element;
    const list = container.children[1] as Element;

    expect(container.type).toBe(BlockType.CalloutBlock);
    expect(list).toMatchObject({ type: BlockType.BulletedListBlock });
    expect(list.children.map(Node.string)).toEqual(['Parent item', 'Nested item']);
  });

  it('preserves the text after the caret when pasting into a nested paragraph inside the callout', () => {
    const editor = createPasteEditor(
      block(BlockType.CalloutBlock, 'Title', [block(BlockType.Paragraph, 'Before after')])
    );

    editor.select({ path: [0, 1, 0, 0], offset: 7 });
    editor.insertData(clipboardData([block(BlockType.Paragraph, 'First'), block(BlockType.Paragraph, 'Last')]));

    expect(editor.children).toHaveLength(2);
    expect((editor.children[0] as Element).children.map(Node.string)).toEqual(['Title', 'Before First', 'Lastafter']);
  });

  it('leaves multiline paste after a collapsed toggle outside its hidden children', () => {
    const editor = createPasteEditor(block(BlockType.ToggleListBlock, 'Title ', [], { collapsed: true }), 6);

    editor.insertData(clipboardData([block(BlockType.Paragraph, 'First'), block(BlockType.Paragraph, 'Last')]));

    expect(editor.children.map(Node.string)).toEqual(['Title First', 'Last', 'Following paragraph']);
    expect((editor.children[0] as Element).children).toHaveLength(1);
  });

  it('preserves inline formatting and restores the entire paste with one undo and redo', async () => {
    const editor = createPasteEditor(block(BlockType.CalloutBlock, ''));
    const original = editor.children;
    const formatted = block(BlockType.Paragraph, 'First');

    (formatted.children[0] as Element).children = [{ text: 'First', bold: true }];
    await Promise.resolve();
    editor.insertData(clipboardData([formatted, block(BlockType.Paragraph, 'Last')]));
    editor.flushLocalChanges();
    await Promise.resolve();

    expect(editor.children).toHaveLength(2);
    const pasted = editor.children;
    const wrapper = (pasted[0] as Element).children[0] as Element;

    expect(wrapper.children).toEqual([{ text: 'First', bold: true }]);
    expect((pasted[0] as Element).children.map(Node.string)).toEqual(['First', 'Last']);
    expect(editor.selection?.anchor).toEqual({ path: [0, 1, 0, 0], offset: 4 });

    editor.undo();
    expect(editor.children).toHaveLength(original.length);
    expect(editor.children[0]).toMatchObject({
      blockId: (original[0] as Element).blockId,
      type: BlockType.CalloutBlock,
    });
    expect((editor.children[0] as Element).children).toHaveLength(1);
    expect(Node.string(editor.children[0])).toBe('');
    editor.redo();
    expect(editor.children).toEqual(pasted);
  });
});
