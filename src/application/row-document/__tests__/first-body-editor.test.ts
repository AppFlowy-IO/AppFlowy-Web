/** @jest-environment node */
import { createEditor, Editor, Node, Transforms } from 'slate';
import * as Y from 'yjs';

import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { CollabOrigin, YSharedRoot } from '@/application/types';
import { getBlock, getChildrenArray, getText } from '@/application/slate-yjs/utils/yjs';

import { createFirstBodyDraft } from '../first-body-actions';
import { FirstBodyOwner } from '../first-body-owner';

jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('lodash-es/isEqual', () => jest.requireActual('lodash/isEqual'));
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

it('keeps continuous Slate input and its caret while the immutable first command awaits ACK', async () => {
  const doc = createFirstBodyDraft('6e91148b-e42a-56b1-b9a0-58fbaa31552d');
  let acknowledge!: () => Promise<void>;
  const canonical = createFirstBodyDraft(doc.guid);
  const canonicalRoot = canonical.getMap('data') as YSharedRoot;
  const page = getBlock(canonicalRoot.get('document').get('page_id'), canonicalRoot);
  const paragraph = getBlock(getChildrenArray(page.get('children'), canonicalRoot).get(0), canonicalRoot);
  const publish = jest.fn(
    (_contribution, finish) =>
      new Promise<Y.Doc>((resolve) => {
        acknowledge = async () => {
          getText(paragraph.get('external_id'), canonicalRoot).insert(0, 'a');
          await finish(canonical, () => undefined);
          resolve(canonical);
        };
      })
  );
  const owner = new FirstBodyOwner(doc, {
    assertCurrent: jest.fn(),
    publish,
    onState: jest.fn(),
    onActivated: jest.fn(),
  });
  const editor = withYjs(createEditor(), doc, { firstBody: owner, readOnly: false, localOrigin: CollabOrigin.Local });

  editor.connect();
  Transforms.select(editor, Editor.start(editor, [0]));
  await flush();
  expect(publish).not.toHaveBeenCalled();
  editor.insertText('a');
  await flush();
  expect(publish).toHaveBeenCalledTimes(1);
  const sealed = JSON.stringify(publish.mock.calls[0][0]);

  for (const character of ' continuous typing') {
    editor.insertText(character);
    await flush();
  }
  const selection = editor.selection;
  const slateNodes = editor.children;

  expect(Node.string(editor)).toBe('a continuous typing');
  expect(JSON.stringify(publish.mock.calls[0][0])).toBe(sealed);
  await acknowledge();
  await flush();
  expect(editor.sharedRoot.doc).toBe(canonical);
  expect(editor.children).toBe(slateNodes);
  expect(editor.selection).toEqual(selection);
  expect(getText(paragraph.get('external_id'), canonicalRoot).toString()).toBe('a continuous typing');
  editor.insertText(' after ACK');
  await flush();
  expect(getText(paragraph.get('external_id'), canonicalRoot).toString()).toBe('a continuous typing after ACK');
  expect(publish).toHaveBeenCalledTimes(1);
  editor.disconnect();
  owner.detach();
});

it('retries a failed persistence barrier after handoff without losing later canonical typing', async () => {
  const draft = createFirstBodyDraft('6e91148b-e42a-56b1-b9a0-58fbaa31552d');
  const canonical = createFirstBodyDraft(draft.guid);
  const textMap = canonical.getMap('data').get('document').get('meta').get('text_map') as Y.Map<Y.Text>;
  const text = Array.from(textMap.values())[0];

  text.insert(0, 'a');
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const publish = jest.fn(async (_contribution, finish) => {
    await held;
    await finish(canonical, () => undefined);
    if (publish.mock.calls.length === 1) throw new Error('temporary storage failure');
    return canonical;
  });
  const owner = new FirstBodyOwner(draft, { assertCurrent: jest.fn(), publish, onState: jest.fn(), onActivated: jest.fn() });
  const editor = withYjs(createEditor(), draft, { firstBody: owner, readOnly: false, localOrigin: CollabOrigin.Local });
  const rebind = jest.spyOn(editor, 'activateFirstBody');

  editor.connect();
  Transforms.select(editor, Editor.start(editor, [0]));
  editor.insertText('a');
  await flush();
  editor.insertText('b');
  await flush();
  release();
  await flush();
  expect(owner.state).toBe('failed');
  expect(editor.firstBody).toBeUndefined();
  editor.insertText('c');
  await flush();
  await owner.retry();
  expect(text.toString()).toBe('abc');
  expect(rebind).toHaveBeenCalledTimes(1);
  expect(owner.state).toBe('activated');
  editor.disconnect();
  owner.detach();
});

it('cancels an IME-held handoff and never applies it after its deadline', async () => {
  const draft = createFirstBodyDraft('6e91148b-e42a-56b1-b9a0-58fbaa31552d');
  const canonical = createFirstBodyDraft(draft.guid);
  const textMap = canonical.getMap('data').get('document').get('meta').get('text_map') as Y.Map<Y.Text>;
  const text = Array.from(textMap.values())[0];

  text.insert(0, 'a');
  const controller = new AbortController();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const activated = jest.fn();
  const owner = new FirstBodyOwner(draft, {
    assertCurrent: jest.fn(), onState: jest.fn(), onActivated: activated,
    publish: async (_contribution, finish) => {
      await held;
      await finish!(canonical, () => { if (controller.signal.aborted) throw controller.signal.reason; }, controller.signal);
      return canonical;
    },
  });
  const editor = withYjs(createEditor(), draft, { firstBody: owner, readOnly: false, localOrigin: CollabOrigin.Local });

  editor.connect();
  Transforms.select(editor, Editor.start(editor, [0]));
  editor.insertText('a');
  await flush();
  owner.beginComposition();
  editor.insertText('正在输入');
  await flush();
  release();
  await flush();
  controller.abort(new Error('publication deadline'));
  await flush();
  expect(owner.state).toBe('failed');
  owner.endComposition();
  await flush();
  expect(text.toString()).toBe('a');
  expect(activated).not.toHaveBeenCalled();
  expect(editor.sharedRoot.doc).toBe(draft);
  editor.disconnect();
  owner.detach();
});
