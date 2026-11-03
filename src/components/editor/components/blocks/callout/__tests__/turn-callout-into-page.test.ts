import cloneDeep from 'lodash-es/cloneDeep';
import { createEditor, Element, Node, Transforms } from 'slate';
import { withReact } from 'slate-react';

import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { CustomEditor } from '@/application/slate-yjs/command';
import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, CollabOrigin, CreatePageResponse, YDoc } from '@/application/types';
import { EditorContextState } from '@/components/editor/EditorContext';

import { DEFAULT_CALLOUT_DATA } from '../callout.utils';
import { turnCalloutIntoPage } from '../turn-callout-into-page';

// The manual mock always returns true; exercise real conflict detection.
jest.unmock('lodash-es/isEqual');

const fixtures: ReturnType<typeof setup>[] = [];
const textBlock = (type: BlockType, text: string, data = {}, children: Element[] = []): Element =>
  ({ type, data, children: [{ type: 'text', children: [{ text }] }, ...children] } as Element);

function setup(title = 'Callout title', body = true) {
  const doc = withTestingYDoc('parent') as YDoc;
  const source = textBlock(
    BlockType.CalloutBlock,
    title,
    DEFAULT_CALLOUT_DATA,
    body
      ? [
          textBlock(BlockType.HeadingBlock, 'Heading', { level: 2 }),
          textBlock(BlockType.ToggleListBlock, 'Toggle', { collapsed: false }, [
            textBlock(BlockType.BulletedListBlock, 'Nested bullet'),
          ]),
          textBlock(BlockType.EquationBlock, '', { formula: 'a^2+b^2=c^2' }),
        ]
      : []
  );

  // Thread IDs belong to the original document; rich formatting is portable.
  if (title)
    (source.children[0] as Element).children = [{ text: title, bold: true, 'comment-ids': ['original-thread'] }];
  slateContentInsertToYData('parent', 0, [source, textBlock(BlockType.Paragraph, 'Following paragraph')], doc);
  const editor = withYHistory(
    withReact(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local }))
  );

  editor.connect();
  editor.undoManager.stopCapturing();
  const id = editor.children[0].blockId!;
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
  const fixture = { editor, doc, context, id, resolve, reject };

  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const { editor, doc } of fixtures.splice(0)) {
    editor.disconnect();
    doc.destroy();
  }
});

it.each(['Callout title', ''])(
  'moves a callout with title %j, formatting, styles and nested body without leaving duplicate children',
  async (title) => {
    const f = setup(title);
    const original = cloneDeep(f.editor.children);
    const pending = turnCalloutIntoPage(f.editor, f.context, f.id);

    expect(f.context.addPage).toHaveBeenCalledWith('parent', {
      layout: 0,
      name: title,
      page_data: {
        type: 'page',
        children: [
          {
            type: 'callout',
            data: {
              ...DEFAULT_CALLOUT_DATA,
              delta: [{ insert: title, ...(title ? { attributes: { bold: true } } : {}) }],
            },
            children: [
              { type: 'heading', data: { level: 2, delta: [{ insert: 'Heading' }] }, children: [] },
              {
                type: 'toggle_list',
                data: { collapsed: false, delta: [{ insert: 'Toggle' }] },
                children: [{ type: 'bulleted_list', data: { delta: [{ insert: 'Nested bullet' }] }, children: [] }],
              },
              { type: 'math_equation', data: { formula: 'a^2+b^2=c^2' }, children: [] },
            ],
          },
        ],
      },
    });
    expect(f.editor.children).toEqual(original);
    f.editor.select(f.editor.start([1]));
    f.resolve({ view_id: 'child' });
    await pending;
    expect(f.editor.children).toHaveLength(2);
    expect(f.editor.children[0]).toMatchObject({ type: 'sub_page', data: { view_id: 'child' } });
    expect(f.editor.children[1]).toEqual(original[1]);
    expect(f.context.openPageModal).toHaveBeenCalledWith('child');
    f.editor.undo();
    expect(f.editor.children).toEqual(original);
    f.editor.redo();
    expect(f.editor.children).toHaveLength(2);
    expect(f.editor.children[0].type).toBe(BlockType.SubpageBlock);
  }
);

it('converts a completely empty callout and ignores repeated clicks while pending', async () => {
  const f = setup('', false);
  const pending = turnCalloutIntoPage(f.editor, f.context, f.id);

  await turnCalloutIntoPage(f.editor, f.context, f.id);
  expect(f.context.addPage).toHaveBeenCalledTimes(1);
  f.resolve({ view_id: 'empty-child' });
  await pending;
  expect(f.editor.children[0]).toMatchObject({ type: 'sub_page', data: { view_id: 'empty-child' } });
});

it('keeps owned nested pages intact instead of letting source deletion trash them', async () => {
  const f = setup();

  CustomEditor.addChildBlock(f.editor, f.id, BlockType.SubpageBlock, { view_id: 'owned-child' });
  const original = cloneDeep(f.editor.children);

  await expect(turnCalloutIntoPage(f.editor, f.context, f.id)).rejects.toThrow('Move nested pages');
  expect(f.context.addPage).not.toHaveBeenCalled();
  expect(f.context.deletePage).not.toHaveBeenCalled();
  expect(f.editor.children).toEqual(original);
});

it('preserves the source on failure and allows retry without a selection or modal', async () => {
  const f = setup();
  const original = cloneDeep(f.editor.children);
  const pending = turnCalloutIntoPage(f.editor, f.context, f.id);

  f.reject(new Error('Creation failed'));
  await expect(pending).rejects.toThrow('Creation failed');
  expect(f.editor.children).toEqual(original);
  f.context.addPage = jest.fn().mockResolvedValue({ view_id: 'retry' });
  f.context.openPageModal = undefined;
  f.editor.selection = null;
  await turnCalloutIntoPage(f.editor, f.context, f.id);
  expect(f.editor.children[0]).toMatchObject({ type: 'sub_page', data: { view_id: 'retry' } });
});

it.each(['title edited', 'body edited', 'styles changed', 'deleted', 'disconnected', 'read-only', 'locked'])(
  'cleans up the new page without overwriting a source that becomes %s',
  async (reason) => {
    const f = setup();
    const pending = turnCalloutIntoPage(f.editor, f.context, f.id);

    if (reason === 'title edited') Transforms.insertText(f.editor, 'New ', { at: f.editor.start([0]) });
    if (reason === 'body edited') Transforms.insertText(f.editor, 'New ', { at: f.editor.start([0, 1]) });
    if (reason === 'styles changed') CustomEditor.setBlockData(f.editor, f.id, { icon: '📌' });
    if (reason === 'deleted') CustomEditor.deleteBlock(f.editor, f.id);
    if (reason === 'disconnected') f.editor.disconnect();
    if (reason === 'read-only') f.editor.readOnly = true;
    if (reason === 'locked') f.editor.isElementReadOnly = () => true;
    f.resolve({ view_id: 'child' });
    await pending;
    expect(f.context.deletePage).toHaveBeenCalledWith('child');
    expect(f.context.openPageModal).not.toHaveBeenCalled();
    expect(f.editor.children.some((node) => node.type === BlockType.SubpageBlock)).toBe(false);
    if (reason === 'title edited' || reason === 'body edited')
      expect(Node.string(f.editor.children[0])).toContain('New ');
  }
);

it.each(['read-only', 'locked', 'disconnected', 'missing', 'not callout', 'no page host'])(
  'does not create a page for %s',
  async (reason) => {
    const f = setup();
    const addPage = f.context.addPage;

    if (reason === 'read-only') f.editor.readOnly = true;
    if (reason === 'locked') f.editor.isElementReadOnly = () => true;
    if (reason === 'disconnected') f.editor.disconnect();
    if (reason === 'missing') CustomEditor.deleteBlock(f.editor, f.id);
    if (reason === 'not callout') CustomEditor.turnToBlock(f.editor, f.id, BlockType.Paragraph, {});
    if (reason === 'no page host') f.context.addPage = undefined;
    await turnCalloutIntoPage(f.editor, f.context, f.id);
    expect(addPage).not.toHaveBeenCalled();
    if (reason !== 'missing') expect(findSlateEntryByBlockId(f.editor, f.id)).toBeDefined();
  }
);
