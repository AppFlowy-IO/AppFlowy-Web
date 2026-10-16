/** @jest-environment node */
import * as Y from 'yjs';

import { createBlock, getBlock, getChildrenArray, getText, updateBlockParent } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YSharedRoot } from '@/application/types';

import { createFirstBodyDraft } from '../first-body-actions';
import { FirstBodyOwner } from '../first-body-owner';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}
function fixture() {
  const doc = createFirstBodyDraft('6e91148b-e42a-56b1-b9a0-58fbaa31552d');
  const root = doc.getMap('data') as YSharedRoot;
  const page = getBlock(root.get('document').get('page_id'), root);
  const paragraph = getBlock(getChildrenArray(page.get('children'), root).get(0), root);
  const text = getText(paragraph.get('external_id'), root);
  const held = deferred<Y.Doc>();
  const callbacks = {
    assertCurrent: jest.fn(),
    assertEditable: jest.fn(),
    publish: jest.fn(() => held.promise),
    onState: jest.fn(),
    onActivated: jest.fn(),
    onClosed: jest.fn(),
  };
  const owner = new FirstBodyOwner(doc, callbacks);

  return { doc, root, page, paragraph, text, held, callbacks, owner };
}

describe('detached first-body owner', () => {
  it('opening and empty/selection-only flushes publish nothing', async () => {
    const { owner, callbacks, text } = fixture();

    text.insert(0, '');
    owner.attachEditor({ flushLocalChanges: jest.fn() });
    await flush();
    expect(callbacks.publish).not.toHaveBeenCalled();
  });

  it('seals the complete synchronous command while accepting separate staged direct writes', async () => {
    const { owner, callbacks, root, page, paragraph, text } = fixture();

    text.insert(0, 'first');
    const second = createBlock(root, { ty: BlockType.Paragraph, data: {} });

    updateBlockParent(root, second, page, 1);
    getText(second.get('external_id'), root).insert(0, 'second');
    await flush();
    expect(owner.state).toBe('publishing');
    expect(callbacks.publish).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(callbacks.publish.mock.calls)).toContain('second');
    const sealed = JSON.stringify(callbacks.publish.mock.calls[0][0]);

    text.insert(0, 'later ');
    paragraph.set('data', '{"align":"center"}');
    expect(owner.allowSlateMutation()).toBe(true);
    expect(text.toString()).toBe('later first');
    expect(JSON.stringify(callbacks.publish.mock.calls[0][0])).toBe(sealed);
    expect(callbacks.publish).toHaveBeenCalledTimes(1);
  });

  it('flushes queued Slate edits before compiling a direct-Yjs command', async () => {
    const { owner, callbacks, text, paragraph } = fixture();

    owner.attachEditor({ flushLocalChanges: () => text.insert(text.length, ' final cell') });
    paragraph.set('data', '{"align":"center"}');
    await flush();
    expect(JSON.stringify(callbacks.publish.mock.calls)).toContain('final cell');
    expect(callbacks.publish).toHaveBeenCalledTimes(1);
  });

  it('does not publish intermediate IME text', async () => {
    const { owner, callbacks, text } = fixture();

    owner.beginComposition();
    text.insert(0, 'intermediate');
    await flush();
    expect(callbacks.publish).not.toHaveBeenCalled();
    text.delete(0, text.length);
    text.insert(0, '完成');
    owner.endComposition();
    await flush();
    expect(callbacks.publish).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(callbacks.publish.mock.calls)).toContain('完成');
    expect(JSON.stringify(callbacks.publish.mock.calls)).not.toContain('intermediate');
  });

  it('keeps one async command across awaits and blocks unrelated mutations', async () => {
    const { owner, callbacks, text } = fixture();
    const command = owner.beginAsync();

    command.run(() => text.insert(0, 'upload batch'));
    await flush();
    expect(callbacks.publish).not.toHaveBeenCalled();
    expect(() => text.insert(0, 'other typing')).toThrow();
    command.run(() => text.insert(text.length, ' complete'));
    command.finish();
    await flush();
    expect(callbacks.publish).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(callbacks.publish.mock.calls)).toContain('upload batch complete');
  });

  it('retries the identical sealed contribution and ignores activation after card close', async () => {
    const { owner, callbacks, text, held } = fixture();

    text.insert(0, 'kept');
    await flush();
    held.reject(new Error('unknown HTTP outcome'));
    await flush();
    expect(owner.state).toBe('failed');
    const contribution = callbacks.publish.mock.calls[0][0];
    const retry = deferred<Y.Doc>();

    callbacks.publish.mockImplementation(() => retry.promise);
    const pending = owner.retry();

    expect(callbacks.publish.mock.calls[1][0]).toBe(contribution);
    owner.detach();
    retry.resolve(new Y.Doc());
    await pending;
    expect(callbacks.onActivated).not.toHaveBeenCalled();
    expect(owner.state).toBe('closed');
    expect(() => text.insert(0, 'late closure')).toThrow();
  });

  it('refuses stale owner and offline edits before either Slate or Yjs mutation', async () => {
    const { owner, callbacks, text } = fixture();

    callbacks.assertCurrent.mockImplementation(() => {
      throw new Error('owner changed');
    });
    expect(owner.allowSlateMutation()).toBe(false);
    expect(() => text.insert(0, 'wrong account')).toThrow('owner changed');
    callbacks.assertCurrent.mockReset();
    callbacks.assertEditable.mockImplementation(() => {
      throw new Error('offline');
    });
    expect(() => text.insert(0, 'offline')).toThrow('offline');
    await flush();
    expect(callbacks.publish).not.toHaveBeenCalled();
    expect(text.toString()).toBe('');
  });

  it('leaves ordinary documents and Yjs prototypes untouched', async () => {
    const original = Y.Text.prototype.insert;
    const { text } = fixture();
    const ordinary = new Y.Doc();
    const ordinaryText = ordinary.getText('existing');

    text.insert(0, 'sealed');
    await flush();
    ordinaryText.insert(0, 'ordinary row and existing body');
    expect(ordinaryText.toString()).toBe('ordinary row and existing body');
    expect(Y.Text.prototype.insert).toBe(original);
  });

  it('finishes an accepted asynchronous command after its card closes, without activating another card', async () => {
    const { owner, callbacks, text, held } = fixture();
    const command = owner.beginAsync();

    owner.detach();
    await flush();
    expect(owner.state).toBe('editing');
    command.run(() => text.insert(0, 'completed upload'));
    command.finish();
    await flush();
    expect(callbacks.publish).toHaveBeenCalledTimes(1);
    held.resolve(new Y.Doc());
    await flush();
    expect(callbacks.onActivated).not.toHaveBeenCalled();
    expect(callbacks.onClosed).toHaveBeenCalledTimes(1);
    expect(owner.state).toBe('closed');
  });

  it('never publishes the successful prefix of a failed async command', async () => {
    const { owner, callbacks, text } = fixture();
    const command = owner.beginAsync();

    command.run(() => text.insert(0, 'incomplete prefix'));
    command.finish(new Error('the second insertion failed'));
    await flush();
    expect(callbacks.publish).not.toHaveBeenCalled();
    expect(owner.state).toBe('failed');
    expect(owner.canRetry).toBe(false);
    expect(() => text.insert(0, 'another edit')).toThrow();
    owner.detach();
    expect(callbacks.onClosed).toHaveBeenCalledTimes(1);
  });

  it('disposes an invalid draft after card close instead of retaining its source listeners', async () => {
    const { owner, callbacks, paragraph } = fixture();

    paragraph.set('ty', BlockType.FeedBlock);
    owner.detach();
    await flush();
    expect(callbacks.publish).not.toHaveBeenCalled();
    expect(owner.state).toBe('closed');
    expect(callbacks.onClosed).toHaveBeenCalledTimes(1);
    owner.detach();
    expect(callbacks.onClosed).toHaveBeenCalledTimes(1);
  });
});
