import { createEditor, Element, Node } from 'slate';
import { withReact } from 'slate-react';
import * as Y from 'yjs';

import { withYjs, YjsEditor } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { CustomEditor } from '@/application/slate-yjs/command';
import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { getBlock, getBlocks, getText, getTextMap } from '@/application/slate-yjs/utils/yjs';
import { BlockType, CollabOrigin, YDoc, YjsEditorKey, YSharedRoot } from '@/application/types';

jest.unmock('lodash-es/isEqual');
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), trace: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const calloutData = { icon: '💡', icon_type: 'emoji', version: 1 };
const textBlock = (type: BlockType, text: string, children: Element[] = [], data = {}): Element =>
  ({ type, data, children: [{ type: YjsEditorKey.text, children: [{ text }] }, ...children] } as Element);
const container = (): Element => ({
  type: BlockType.CalloutBlock,
  data: calloutData,
  children: [
    textBlock(BlockType.ToggleListBlock, 'Toggle title', [textBlock(BlockType.Paragraph, 'Expanded body')], {
      collapsed: false,
      level: 2,
    }),
    textBlock(BlockType.BulletedListBlock, 'Sibling bullet'),
  ],
} as Element);

// Flutter's BlockToNode adapter reads external text into attributes.delta, and
// CalloutBlockComponentBuilder.validate requires that delta to be non-null.
function expectNativeCalloutText(root: YSharedRoot) {
  const callouts = Array.from(getBlocks(root).values()).filter(
    (block) => block.get(YjsEditorKey.block_type) === BlockType.CalloutBlock
  );

  expect(callouts.length).toBeGreaterThan(0);
  callouts.forEach((block) => {
    expect(block.get(YjsEditorKey.block_external_type)).toBe('text');
    const delta = getText(block.get(YjsEditorKey.block_external_id), root)?.toDelta();

    expect(Array.isArray(delta)).toBe(true);
  });
}

describe('callout compatibility with unchanged Flutter clients', () => {
  const editors: YjsEditor[] = [];
  const docs: YDoc[] = [];
  function createDoc(nodes = [container()]) {
    const doc = withTestingYDoc('callout-compatibility');

    docs.push(doc);
    slateContentInsertToYData('callout-compatibility', 0, nodes, doc);
    return doc;
  }
  function connect(doc: YDoc, readOnly = false) {
    const editor = withYHistory(withReact(withYjs(createEditor(), doc, { readOnly, localOrigin: CollabOrigin.Local })));

    editor.connect();
    editors.push(editor);
    return editor;
  }
  function removeCompatibilityText(doc: YDoc) {
    const root = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const callout = Array.from(getBlocks(root).values()).find(
      (block) => block.get(YjsEditorKey.block_type) === BlockType.CalloutBlock
    )!;

    getTextMap(root).delete(callout.get(YjsEditorKey.block_external_id));
    callout.delete(YjsEditorKey.block_external_id);
    callout.delete(YjsEditorKey.block_external_type);
    callout.set(YjsEditorKey.block_data, JSON.stringify(calloutData));
    return callout;
  }
  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.disconnect());
    docs.splice(0).forEach((doc) => doc.destroy());
  });

  it('persists a native-compatible callout while showing its toggle child as the web title', () => {
    const doc = createDoc();
    const editor = connect(doc);
    const callout = editor.children[0] as Element;

    expectNativeCalloutText(editor.sharedRoot);
    expect(callout.children.map(Node.string)).toEqual(['Toggle titleExpanded body', 'Sibling bullet']);
    expect(callout.children[0]).toMatchObject({ type: BlockType.ToggleListBlock, data: { collapsed: false, level: 2 } });
    expect(callout.data).toMatchObject({ ...calloutData, title_mode: 'block' });
    expect(yDocToSlateContent(doc)?.children).toEqual(editor.children);
  });

  it('preserves compatibility through title formatting, duplication, and a new-document paste', () => {
    const editor = connect(createDoc([textBlock(BlockType.CalloutBlock, 'Title', [], calloutData)]));

    editor.select({ path: [0, 0, 0], offset: 3 });
    CustomEditor.formatBlock(editor, (editor.children[0] as Element).blockId!, BlockType.ToggleListBlock, { collapsed: true });
    const callout = editor.children[0] as Element;

    CustomEditor.duplicateBlock(editor, callout.blockId!);
    expectNativeCalloutText(editor.sharedRoot);
    editor.children.forEach((node) => {
      expect((node as Element).children[0]).toMatchObject({ type: BlockType.ToggleListBlock, data: { collapsed: true } });
    });
    const pasted = connect(createDoc(editor.children as Element[]));

    expectNativeCalloutText(pasted.sharedRoot);
    expect(pasted.children.map(Node.string)).toEqual(['Title', 'Title']);
  });

  it.each([false, true])('shows native title edits once, including concurrent style changes: %s', (changeStyle) => {
    const doc = createDoc();
    const editor = connect(doc);
    const callout = getBlock((editor.children[0] as Element).blockId!, editor.sharedRoot);
    const text = getText(callout.get(YjsEditorKey.block_external_id), editor.sharedRoot);

    editor.select({ path: [0, 0, 0, 0], offset: 3 });
    doc.transact(() => {
      if (changeStyle) {
        callout.set(YjsEditorKey.block_data, JSON.stringify({ ...calloutData, title_mode: 'block', textColor: 'red' }));
      }
      text.insert(0, 'Written in Flutter');
    }, CollabOrigin.Remote);
    expect((editor.children[0] as Element).children.map(Node.string)).toEqual([
      'Written in Flutter', 'Toggle titleExpanded body', 'Sibling bullet',
    ]);
    expect(editor.selection?.anchor).toEqual({ path: [0, 1, 0, 0], offset: 3 });
    expect(yDocToSlateContent(doc)?.children).toEqual(editor.children);

    doc.transact(() => text.delete(0, text.length), CollabOrigin.Remote);
    expect((editor.children[0] as Element).children.map(Node.string)).toEqual(['Toggle titleExpanded body', 'Sibling bullet']);
    expect(editor.selection?.anchor).toEqual({ path: [0, 0, 0, 0], offset: 3 });
    expect(yDocToSlateContent(doc)?.children).toEqual(editor.children);
    expectNativeCalloutText(editor.sharedRoot);
  });

  it('retains the title layout when native clients change only callout styling', () => {
    const doc = createDoc();
    const editor = connect(doc);
    const callout = getBlock((editor.children[0] as Element).blockId!, editor.sharedRoot);

    doc.transact(() => {
      callout.set(YjsEditorKey.block_data, JSON.stringify({ ...calloutData, title_mode: 'block', icon: '✅' }));
    }, CollabOrigin.Remote);
    expect((editor.children[0] as Element).children[0]).toMatchObject({ type: BlockType.ToggleListBlock });
    expect(yDocToSlateContent(doc)?.children).toEqual(editor.children);
    expectNativeCalloutText(editor.sharedRoot);
  });

  it('repairs previously saved textless callouts without replacing blocks or creating an undo step', () => {
    const doc = createDoc();
    const callout = removeCompatibilityText(doc);
    const before = yDocToSlateContent(doc)?.children[0] as Element;
    const editor = connect(doc);
    const after = editor.children[0] as Element;

    expect(after.blockId).toBe(callout.get(YjsEditorKey.block_id));
    expect(after.children).toEqual(before.children);
    expect(after.data).toMatchObject(calloutData);
    expectNativeCalloutText(editor.sharedRoot);
    expect(editor.undoManager.undoStack).toHaveLength(0);
    const state = Y.encodeStateAsUpdateV2(doc);

    editor.disconnect();
    editor.connect();
    expect(Y.encodeStateAsUpdateV2(doc)).toEqual(state);
  });

  it('does not write repairs when the document is read-only', () => {
    const doc = createDoc();

    removeCompatibilityText(doc);
    const state = Y.encodeStateAsUpdateV2(doc);
    const editor = connect(doc, true);

    expect((editor.children[0] as Element).children[0]).toMatchObject({ type: BlockType.ToggleListBlock });
    expect(Y.encodeStateAsUpdateV2(doc)).toEqual(state);
  });

  it('repairs textless callouts arriving from an older web client', async () => {
    const doc = createDoc([]);
    const editor = connect(doc);

    doc.transact(() => {
      slateContentInsertToYData('callout-compatibility', 0, [container()], doc);
      removeCompatibilityText(doc);
    }, CollabOrigin.Remote);
    await Promise.resolve();
    expectNativeCalloutText(editor.sharedRoot);
    expect(yDocToSlateContent(doc)?.children).toEqual(editor.children);
    expect(Node.string(editor.children[0])).toBe('Toggle titleExpanded bodySibling bullet');
  });

  it('keeps an ordinary empty callout title visible', () => {
    const doc = createDoc([textBlock(BlockType.CalloutBlock, '', [textBlock(BlockType.ToggleListBlock, 'Body toggle')], calloutData)]);
    const editor = connect(doc);

    expect((editor.children[0] as Element).children[0]).toMatchObject({ type: YjsEditorKey.text });
    expect((editor.children[0] as Element).children.map(Node.string)).toEqual(['', 'Body toggle']);
    expectNativeCalloutText(editor.sharedRoot);
    expect(yDocToSlateContent(doc)?.children).toEqual(editor.children);
  });
});
