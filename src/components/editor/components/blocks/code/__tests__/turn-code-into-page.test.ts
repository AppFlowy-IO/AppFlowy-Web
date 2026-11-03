import cloneDeep from 'lodash-es/cloneDeep';
import { createEditor, Element, Node, Transforms } from 'slate';
import { withReact } from 'slate-react';

import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { CustomEditor } from '@/application/slate-yjs/command';
import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, CodeBlockData, CollabOrigin, CreatePageResponse, YDoc } from '@/application/types';
import { EditorContextState } from '@/components/editor/EditorContext';

import { turnCodeIntoPage } from '../turn-code-into-page';

// The repository's manual mock always returns true; exercise actual conflict detection.
jest.unmock('lodash-es/isEqual');

const fixtures: ReturnType<typeof setup>[] = [];

function setup(
  text = 'const value = `<tag> $x$`; \n  // 保留 whitespace',
  data: CodeBlockData = { language: 'javascript' }
) {
  const doc = withTestingYDoc('parent') as YDoc;

  slateContentInsertToYData(
    'parent',
    0,
    [
      {
        type: BlockType.CodeBlock,
        data,
        children: [{ type: 'text', children: [{ text }] }],
      } as Element,
    ],
    doc
  );
  const editor = withYHistory(
    withReact(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local }))
  );

  editor.connect();
  const id = editor.children[0].blockId!;

  editor.undoManager.stopCapturing();
  let resolve!: (response: CreatePageResponse) => void;
  let reject!: (error: Error) => void;
  const request = new Promise<CreatePageResponse>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const context: EditorContextState = {
    viewId: 'parent',
    workspaceId: 'workspace',
    readOnly: false,
    addPage: jest.fn(() => request),
    deletePage: jest.fn().mockResolvedValue(undefined),
    openPageModal: jest.fn(),
  };
  const fixture = { doc, editor, context, id, text, resolve, reject };

  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const { editor, doc } of fixtures.splice(0)) {
    editor.disconnect();
    doc.destroy();
  }
});

it.each([
  [
    'code',
    'const value = `<tag> $x$`; \n  // 保留 whitespace',
    { language: 'javascript', caption: 'Example', pin_language: true, wrap_code: true },
  ],
  [
    'Mermaid',
    'graph TD\n  Mermaid --> Diagram',
    { language: 'mermaid', caption: 'Diagram', mermaid_display_mode: 'preview' },
  ],
  ['empty code', '', { language: '' }],
] as [string, string, CodeBlockData][])(
  'copies the complete %s block and replaces only the source after creation succeeds',
  async (_name, text, data) => {
    const f = setup(text, data);
    const original = cloneDeep(findSlateEntryByBlockId(f.editor, f.id)![0]);
    const sibling = CustomEditor.addBelowBlock(f.editor, f.id, BlockType.Paragraph, {})!;
    const pending = turnCodeIntoPage(f.editor, f.context, f.id);

    expect(f.context.addPage).toHaveBeenCalledWith('parent', {
      layout: 0,
      page_data: {
        type: 'page',
        children: [{ type: 'code', data: { ...data, delta: [{ insert: text }] }, children: [] }],
      },
    });
    expect(findSlateEntryByBlockId(f.editor, f.id)![0]).toEqual(original);
    f.editor.select(f.editor.start(findSlateEntryByBlockId(f.editor, sibling)![1]));
    f.resolve({ view_id: 'child' });
    await pending;
    expect(f.editor.children[0]).toMatchObject({ type: 'sub_page', data: { view_id: 'child' } });
    expect(findSlateEntryByBlockId(f.editor, sibling)).toBeDefined();
    expect(f.context.openPageModal).toHaveBeenCalledWith('child');

    f.editor.undo();
    expect(f.editor.children[0]).toEqual(original);
    f.editor.redo();
    expect(f.editor.children[0]).toMatchObject({ type: 'sub_page', data: { view_id: 'child' } });
  }
);

it('keeps the source on a failed request and allows retry', async () => {
  const f = setup();
  const pending = turnCodeIntoPage(f.editor, f.context, f.id);

  f.reject(new Error('Creation failed'));
  await expect(pending).rejects.toThrow('Creation failed');
  expect(Node.string(findSlateEntryByBlockId(f.editor, f.id)![0])).toBe(f.text);
  expect(f.context.openPageModal).not.toHaveBeenCalled();
  f.context.addPage = jest.fn().mockResolvedValue({ view_id: 'retry' });
  await turnCodeIntoPage(f.editor, f.context, f.id);
  expect(f.editor.children[0]).toMatchObject({ type: 'sub_page', data: { view_id: 'retry' } });
});

it.each(['edited', 'settings changed', 'deleted', 'disconnected', 'read-only'])(
  'cleans up the new page without replacing the source when it becomes %s during creation',
  async (reason) => {
    const f = setup();
    const pending = turnCodeIntoPage(f.editor, f.context, f.id);

    if (reason === 'edited') Transforms.insertText(f.editor, 'new content', { at: f.editor.start([0]) });
    if (reason === 'settings changed') CustomEditor.setBlockData(f.editor, f.id, { caption: 'New caption' });
    f.editor.flushLocalChanges();
    if (reason === 'deleted') CustomEditor.deleteBlock(f.editor, f.id);
    if (reason === 'disconnected') f.editor.disconnect();
    if (reason === 'read-only') f.editor.readOnly = true;
    if (reason === 'edited') expect(Node.string(f.editor.children[0])).toContain('new content');
    if (reason === 'settings changed') expect(f.editor.children[0].data).toMatchObject({ caption: 'New caption' });
    f.resolve({ view_id: 'child' });
    await pending;
    expect(f.context.deletePage).toHaveBeenCalledWith('child');
    expect(f.context.openPageModal).not.toHaveBeenCalled();
    expect(f.editor.children.some((node) => node.type === BlockType.SubpageBlock)).toBe(false);
    if (reason === 'edited') expect(Node.string(f.editor.children[0])).toContain('new content');
    if (reason === 'settings changed') expect(f.editor.children[0].data).toMatchObject({ caption: 'New caption' });
  }
);

it('ignores repeat requests and works without a selection or page modal', async () => {
  const f = setup();

  f.editor.selection = null;
  f.context.openPageModal = undefined;
  const first = turnCodeIntoPage(f.editor, f.context, f.id);

  await turnCodeIntoPage(f.editor, f.context, f.id);
  expect(f.context.addPage).toHaveBeenCalledTimes(1);
  f.resolve({ view_id: 'child' });
  await first;
  expect(f.editor.children[0]).toMatchObject({ type: 'sub_page', data: { view_id: 'child' } });
});

it.each(['read-only', 'disconnected', 'missing', 'not code'])(
  'does not create a page for a %s source',
  async (reason) => {
    const f = setup();

    if (reason === 'read-only') f.editor.readOnly = true;
    if (reason === 'disconnected') f.editor.disconnect();
    if (reason === 'missing') CustomEditor.deleteBlock(f.editor, f.id);
    if (reason === 'not code') CustomEditor.turnToBlock(f.editor, f.id, BlockType.Paragraph, {});
    await turnCodeIntoPage(f.editor, f.context, f.id);
    expect(f.context.addPage).not.toHaveBeenCalled();
  }
);
