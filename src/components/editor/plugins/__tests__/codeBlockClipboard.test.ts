import { createEditor, Element, Node } from 'slate';
import { withReact } from 'slate-react';

import { withYjs, YjsEditor } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';
import { clipboardFormatKey } from '@/components/editor/plugins/withCopy';
import { withInsertData } from '@/components/editor/plugins/withInsertData';
import { withPasted } from '@/components/editor/plugins/withPasted';

jest.mock('@/components/editor/parsers/html-parser', () => ({ parseHTML: jest.fn() }));
jest.mock('@/components/editor/parsers/markdown-parser', () => ({ parseMarkdown: jest.fn() }));

const code = '  const message = "你好 👋";\n\tconsole.log(message);\n';

function block(type: BlockType, text: string): Element {
  return {
    type,
    data: type === BlockType.CodeBlock ? { language: 'javascript' } : {},
    children: [{ type: YjsEditorKey.text, children: [{ text }] }],
  } as Element;
}

function clipboardData(values: Record<string, string>): DataTransfer {
  return {
    files: [],
    types: Object.keys(values),
    getData: (type: string) => values[type] ?? '',
  } as unknown as DataTransfer;
}

function richClipboardData(format: string, sourceType: BlockType): DataTransfer {
  const encoded = window.btoa(encodeURIComponent(JSON.stringify([block(sourceType, code)])));

  return clipboardData({
    'text/plain': code,
    [format]: format === 'text/html' ? `<span data-slate-fragment="${encoded}">code</span>` : encoded,
  });
}

describe('code block clipboard', () => {
  const editors: YjsEditor[] = [];

  afterEach(() => {
    for (const editor of editors.splice(0)) {
      editor.disconnect();
      editor.sharedRoot.doc?.destroy();
    }
  });

  function createPasteEditor(text: string, start: number, end = start, type = BlockType.CodeBlock) {
    const doc = withTestingYDoc('clipboard-page');

    slateContentInsertToYData('clipboard-page', 0, [block(type, text)], doc);

    const editor = withInsertData(
      withPasted(
        withReact(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local }), clipboardFormatKey)
      )
    ) as YjsEditor;

    editor.connect();
    editor.select({ anchor: { path: [0, 0, 0], offset: start }, focus: { path: [0, 0, 0], offset: end } });
    editors.push(editor);
    return editor;
  }

  function expectCode(editor: YjsEditor, expected: string, originalBlockId?: string) {
    expect(editor.children).toHaveLength(1);
    expect(editor.children[0]).toMatchObject({ type: BlockType.CodeBlock, data: { language: 'javascript' } });
    expect(Node.string(editor.children[0])).toBe(expected);
    if (originalBlockId) expect((editor.children[0] as Element).blockId).toBe(originalBlockId);

    editor.flushLocalChanges();
    const saved = yDocToSlateContent(editor.sharedRoot.doc!);

    expect(saved.children).toHaveLength(1);
    expect(Node.string(saved.children[0])).toBe(expected);
  }

  it.each(['application/x-appflowy-fragment', 'application/x-slate-fragment', 'text/html'])(
    'pastes %s into the code block at the caret, preserving whitespace and surrounding text',
    (format) => {
      const editor = createPasteEditor('before AFTER', 7);
      const originalBlockId = (editor.children[0] as Element).blockId;

      editor.insertData(richClipboardData(format, BlockType.CodeBlock));

      expectCode(editor, `before ${code}AFTER`, originalBlockId);
      expect(editor.selection?.anchor).toEqual({ path: [0, 0, 0], offset: 7 + code.length });
      expect(editor.selection?.focus).toEqual(editor.selection?.anchor);
    }
  );

  it('keeps an empty code block and its language when pasting copied paragraph text', () => {
    const editor = createPasteEditor('', 0);
    const originalBlockId = (editor.children[0] as Element).blockId;

    editor.insertData(richClipboardData('application/x-appflowy-fragment', BlockType.Paragraph));

    expectCode(editor, code, originalBlockId);
  });

  it('replaces selected code with copied text without creating another block', () => {
    const editor = createPasteEditor('before REPLACE after', 7, 14);

    editor.insertData(richClipboardData('application/x-appflowy-fragment', BlockType.CodeBlock));

    expectCode(editor, `before ${code} after`);
  });

  it.each([{ 'text/plain': code }, { 'text/plain': code, 'text/html': '<pre><code>formatted code</code></pre>' }])(
    'continues to paste external clipboard text literally inside code blocks',
    (values) => {
      const editor = createPasteEditor('', 0);

      editor.insertData(clipboardData(values));

      expectCode(editor, code);
    }
  );

  it('preserves a copied code block when pasted after paragraph text', () => {
    const editor = createPasteEditor('paragraph', 9, 9, BlockType.Paragraph);

    editor.insertData(richClipboardData('application/x-appflowy-fragment', BlockType.CodeBlock));

    expect(editor.children).toHaveLength(2);
    expect(editor.children[0]).toMatchObject({ type: BlockType.Paragraph });
    expect(Node.string(editor.children[0])).toBe('paragraph');
    expect(editor.children[1]).toMatchObject({ type: BlockType.CodeBlock, data: { language: 'javascript' } });
    expect(Node.string(editor.children[1])).toBe(code);
    editor.flushLocalChanges();
    expect(yDocToSlateContent(editor.sharedRoot.doc!).children.map(Node.string)).toEqual(['paragraph', code]);
  });
});
