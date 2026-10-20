import { createEditor, Element, Node } from 'slate';
import { withReact } from 'slate-react';

import { withYjs, YjsEditor } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';

import { codeBoundary, CodeKey, CodePlatform, handleCodeKeyDown, indentCodeLines } from '../code-keyboard';

const key = (key: string, extra: Partial<CodeKey> = {}): CodeKey => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...extra,
});
const text = 'first line\nsecond line\nthird';

describe('Flutter code_block_line_shortcut_test parity', () => {
  test.each([
    ['windows', key('Home'), 15, 11],
    ['windows', key('End'), 15, 22],
    ['windows', key('Home', { ctrlKey: true }), 15, 0],
    ['windows', key('End', { ctrlKey: true }), 15, text.length],
    ['windows', key('Home', { ctrlKey: true, shiftKey: true }), 15, 0],
    ['windows', key('End', { ctrlKey: true, shiftKey: true }), 15, text.length],
    ['mac', key('Home'), 15, 0],
    ['mac', key('End'), 15, text.length],
    ['mac', key('ArrowLeft', { metaKey: true }), 15, 11],
    ['mac', key('ArrowRight', { metaKey: true }), 15, 22],
    ['linux', key('ArrowLeft', { ctrlKey: true }), 15, 11],
    ['linux', key('ArrowRight', { ctrlKey: true }), 15, 22],
    ['mac', key('ArrowLeft', { metaKey: true, shiftKey: true }), 15, 11],
    ['linux', key('ArrowRight', { ctrlKey: true, shiftKey: true }), 15, 22],
    ['mac', key('ArrowUp', { metaKey: true }), 15, 0],
    ['linux', key('ArrowDown', { ctrlKey: true }), 15, text.length],
    ['windows', key('ArrowLeft', { ctrlKey: true }), 15, undefined],
    ['windows', key('ArrowRight', { ctrlKey: true, shiftKey: true }), 15, undefined],
  ] as [CodePlatform, CodeKey, number, number | undefined][])(
    '%s %j at %i resolves %s',
    (platform, event, offset, expected) => {
      expect(codeBoundary(text, offset, event, platform)).toBe(expected);
    }
  );
  test('Home/End never leave the block when repeated at a boundary (#8446)', () => {
    expect(codeBoundary(text, 11, key('Home'), 'windows')).toBe(11);
    expect(codeBoundary(text, 22, key('End'), 'windows')).toBe(22);
    expect(codeBoundary('\nnext', 0, key('Home'), 'windows')).toBe(0);
    expect(codeBoundary('', 0, key('End'), 'windows')).toBe(0);
  });
  test('indent selected lines and preserve backward selection (#4971)', () => {
    expect(indentCodeLines('one\ntwo\nthree', 6, 1, false)).toEqual({
      text: '  one\n  two\nthree',
      anchor: 10,
      focus: 3,
    });
    expect(indentCodeLines('  one\n  two\nthree', 10, 3, true)).toEqual({
      text: 'one\ntwo\nthree',
      anchor: 6,
      focus: 1,
    });
  });
  test('selection ending at a line start does not indent the next line', () => {
    expect(indentCodeLines('one\ntwo', 0, 4, false)).toEqual({ text: '  one\ntwo', anchor: 2, focus: 6 });
  });
  test('outdent removes up to two spaces or a tab, never code', () => {
    expect(indentCodeLines(' one\n\ttwo\nthree', 0, 15, true).text).toBe('one\ntwo\nthree');
    expect(indentCodeLines('one', 1, 1, true)).toEqual({ text: 'one', anchor: 1, focus: 1 });
  });
});

describe('code editing transactions preserve Yjs block identity and data', () => {
  const editors: YjsEditor[] = [];

  afterEach(() => {
    for (const editor of editors.splice(0)) {
      editor.disconnect();
      editor.sharedRoot.doc?.destroy();
    }
  });
  function setup(text: string, anchor: number, focus = anchor) {
    const doc = withTestingYDoc('code-page');

    slateContentInsertToYData(
      'code-page',
      0,
      [
        {
          type: BlockType.CodeBlock,
          data: { language: 'python', caption: 'caption', pin_language: true },
          children: [{ type: YjsEditorKey.text, children: [{ text }] }],
        } as Element,
      ],
      doc
    );
    const editor = withReact(
      withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local })
    ) as YjsEditor;

    editor.connect();
    editor.select({ anchor: { path: [0, 0, 0], offset: anchor }, focus: { path: [0, 0, 0], offset: focus } });
    editors.push(editor);

    return editor;
  }

  test('Tab inserts two spaces at a collapsed caret', () => {
    const editor = setup('abcd', 2);
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });

    expect(handleCodeKeyDown(editor, event, 'mac')).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(Node.string(editor.children[0])).toBe('ab  cd');
  });
  test('Enter carries the indentation without splitting or changing metadata', () => {
    const editor = setup('  abc', 5);
    const before = editor.children[0] as Element;

    handleCodeKeyDown(editor, new KeyboardEvent('keydown', { key: 'Enter' }), 'mac');
    expect(Node.string(editor.children[0])).toBe('  abc\n  ');
    editor.flushLocalChanges();
    expect(yDocToSlateContent(editor.sharedRoot.doc!).children[0]).toMatchObject({
      blockId: before.blockId,
      data: before.data,
      type: BlockType.CodeBlock,
    });
  });
  test('multi-line indent and outdent keep the selected code intact', () => {
    const editor = setup('one\ntwo\nthree', 1, 6);

    handleCodeKeyDown(editor, new KeyboardEvent('keydown', { key: 'Tab' }), 'mac');
    expect(Node.string(editor.children[0])).toBe('  one\n  two\nthree');
    expect(editor.selection?.anchor.offset).toBe(3);
    expect(editor.selection?.focus.offset).toBe(10);
    handleCodeKeyDown(editor, new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }), 'mac');
    expect(Node.string(editor.children[0])).toBe('one\ntwo\nthree');
  });
  test('shift movement keeps the anchor while moving focus to line end', () => {
    const editor = setup(text, 15);

    handleCodeKeyDown(editor, new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true, shiftKey: true }), 'mac');
    expect(editor.selection?.anchor.offset).toBe(15);
    expect(editor.selection?.focus.offset).toBe(22);
  });
  test('plain arrow keys remain native and composing Enter is ignored', () => {
    const editor = setup(text, 15);
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });

    handleCodeKeyDown(editor, down, 'mac');
    expect(down.defaultPrevented).toBe(false);
    handleCodeKeyDown(editor, new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }), 'mac');
    expect(Node.string(editor.children[0])).toBe(text);
  });
});
