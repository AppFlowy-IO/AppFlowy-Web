import { createEditor, Element, Node, Transforms } from 'slate';
import { withReact } from 'slate-react';

import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { CustomEditor } from '@/application/slate-yjs/command';
import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, YDoc } from '@/application/types';
import { CodeNode } from '@/components/editor/editor.type';

import { formatCode } from '../format-code';

const fixtures: ReturnType<typeof setup>[] = [];

function setup(text = 'const value={a:1}', language = 'javascript') {
  const doc = withTestingYDoc('parent') as YDoc;

  slateContentInsertToYData(
    'parent',
    0,
    [
      {
        type: BlockType.CodeBlock,
        data: { language, caption: 'Keep caption', wrap_code: true },
        children: [{ type: 'text', children: [{ text }] }],
      } as Element,
    ],
    doc
  );
  const editor = withReact(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local }));

  editor.connect();
  const source = editor.children[0] as CodeNode;
  const fixture = { doc, editor, source, text };

  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const { editor, doc } of fixtures.splice(0)) {
    editor.disconnect();
    doc.destroy();
  }
});

it('formats source without changing the block identity or metadata', async () => {
  const { editor, source } = setup();

  await formatCode(editor, source);
  expect(Node.string(editor.children[0])).toBe('const value = { a: 1 };');
  expect(editor.children[0]).toMatchObject({ blockId: source.blockId, data: source.data });
});

it.each(['disconnected', 'edited', 'deleted', 'converted', 'language changed', 'read-only'])(
  'ignores a formatting result when its source becomes %s while the formatter loads',
  async (reason) => {
    const { editor, source } = setup();
    const pending = formatCode(editor, source);

    if (reason === 'disconnected') editor.disconnect();
    if (reason === 'edited') Transforms.insertText(editor, 'new source', { at: editor.start([0]) });
    if (reason === 'deleted') CustomEditor.deleteBlock(editor, source.blockId);
    if (reason === 'converted') CustomEditor.turnToBlock(editor, source.blockId, BlockType.Paragraph, {});
    if (reason === 'language changed') CustomEditor.setBlockData(editor, source.blockId, { language: 'plaintext' });
    if (reason === 'read-only') editor.readOnly = true;
    const before = JSON.stringify(editor.children);

    await pending;
    expect(JSON.stringify(editor.children)).toBe(before);
  }
);
