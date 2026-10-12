/** @jest-environment node */
import { createEditor, Editor, Transforms } from 'slate';
import type { ReactEditor } from 'slate-react';
import * as Y from 'yjs';

import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { CollabOrigin } from '@/application/types';
import { insertFirstBodyFiles } from '@/components/editor/plugins/insert-first-body-files';

import { createFirstBodyDraft } from '../first-body-actions';
import { FirstBodyOwner } from '../first-body-owner';

jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function fixture() {
  const doc = createFirstBodyDraft('6e91148b-e42a-56b1-b9a0-58fbaa31552d');
  const publish = jest.fn(() => new Promise<Y.Doc>(() => undefined));
  const assertCurrent = jest.fn();
  const owner = new FirstBodyOwner(doc, { assertCurrent, publish, onState: jest.fn(), onActivated: jest.fn() });
  const uploads = [deferred<string>(), deferred<string>()];
  const uploadFile = jest
    .fn()
    .mockImplementationOnce(() => uploads[0].promise)
    .mockImplementationOnce(() => uploads[1].promise);
  const editor = withYjs(createEditor(), doc, {
    firstBody: owner,
    readOnly: false,
    localOrigin: CollabOrigin.Local,
    uploadFile,
  });

  editor.connect();
  Transforms.select(editor, Editor.start(editor, [0]));
  const files = [
    { name: 'first.png', type: 'image/png' },
    { name: 'second.txt', type: 'text/plain' },
  ] as File[];

  return { doc, owner, editor, uploads, uploadFile, publish, assertCurrent, files };
}

describe('first-body file command', () => {
  it('waits for every upload, then seals complete media without local placeholders', async () => {
    const { editor, uploads, files, publish, owner } = fixture();

    expect(insertFirstBodyFiles(editor as ReactEditor, files)).toBe(true);
    uploads[0].resolve('https://example.test/first.png');
    await flush();
    expect(publish).not.toHaveBeenCalled();
    expect(owner.busy).toBe(true);
    editor.insertText('unrelated typing');
    uploads[1].resolve('https://example.test/second.txt');
    await flush();
    expect(publish).toHaveBeenCalledTimes(1);
    const actions = JSON.stringify(publish.mock.calls);

    expect(actions).toContain('https://example.test/first.png');
    expect(actions).toContain('https://example.test/second.txt');
    expect(actions).not.toContain('unrelated typing');
    expect(actions).not.toContain('pending_upload_id');
    expect(actions).not.toContain('retry_local_url');
  });

  it('does not publish a successful upload prefix when another file fails', async () => {
    const { editor, uploads, files, publish, owner } = fixture();

    insertFirstBodyFiles(editor as ReactEditor, files);
    uploads[0].resolve('https://example.test/first.png');
    uploads[1].reject(new Error('upload failed'));
    await flush();
    expect(publish).not.toHaveBeenCalled();
    expect(owner.state).toBe('editing');
    expect(owner.busy).toBe(false);
    expect(editor.children).toHaveLength(1);
  });

  it('keeps the accepted upload after card close but rejects an account cutover', async () => {
    for (const ownerChanged of [false, true]) {
      const { editor, uploads, files, publish, owner, assertCurrent } = fixture();

      insertFirstBodyFiles(editor as ReactEditor, files);
      owner.detach();
      editor.disconnect();
      if (ownerChanged)
        assertCurrent.mockImplementation(() => {
          throw new Error('account changed');
        });
      uploads[0].resolve('https://example.test/first.png');
      uploads[1].resolve('https://example.test/second.txt');
      await flush();
      expect(publish).toHaveBeenCalledTimes(ownerChanged ? 0 : 1);
      expect(owner.state).toBe(ownerChanged ? 'closed' : 'publishing');
    }
  });
});
