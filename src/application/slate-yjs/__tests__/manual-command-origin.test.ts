import { createEditor, Editor, Transforms } from 'slate';
import * as Y from 'yjs';

import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { handleDeleteEntireDocumentWithTxn } from '@/application/slate-yjs/utils/editor';
import { executeOperations, getTextMap, initializeDocumentStructure } from '@/application/slate-yjs/utils/yjs';
import { CollabOrigin, YDoc, YjsEditorKey, YSharedRoot } from '@/application/types';

jest.mock('nanoid');
jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('lodash-es/isEqual', () => jest.requireActual('lodash/isEqual'));

it('identifies the actual clear command as local and preserves clear/undo/redo editor content', async () => {
  const doc = new Y.Doc({ guid: '11111111-1111-4111-8111-111111111111' }) as YDoc;

  initializeDocumentStructure(doc, true, doc.guid);
  const root = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const text = Array.from(getTextMap(root).values())[0];

  text.insert(0, 'body to clear');
  const editor = withYHistory(withYjs(createEditor(), doc, {
    readOnly: false,
    localOrigin: CollabOrigin.Local,
  }));
  const updates: { origin: unknown; text: string }[] = [];

  editor.connect();
  doc.on('update', (_update, origin) => {
    // The same document event used by the Row content indicator sees the
    // connected Slate editor after the command's Yjs changes are applied.
    updates.push({ origin, text: Editor.string(editor, []) });
  });
  try {
    Transforms.select(editor, Editor.range(editor, []));
    await Promise.resolve();
    handleDeleteEntireDocumentWithTxn(editor);
    await Promise.resolve();
    expect(Editor.string(editor, [])).toBe('');
    expect(updates).toEqual([{ origin: CollabOrigin.LocalManual, text: '' }]);
    expect(editor.undoManager.undoStack).toHaveLength(1);

    editor.undo();
    await Promise.resolve();
    expect(Editor.string(editor, [])).toBe('body to clear');
    expect(updates.at(-1)).toEqual({ origin: editor.undoManager, text: 'body to clear' });

    editor.redo();
    await Promise.resolve();
    expect(Editor.string(editor, [])).toBe('');
    expect(updates.at(-1)).toEqual({ origin: editor.undoManager, text: '' });
  } finally {
    editor.disconnect();
    editor.undoManager.destroy();
    doc.destroy();
  }
});

it('preserves an explicit origin and the outer origin of nested document operations', () => {
  const doc = new Y.Doc() as YDoc;
  const root = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const origins: unknown[] = [];

  doc.on('update', (_update, origin) => origins.push(origin));
  executeOperations(root, [() => root.set('explicit-test', true)], 'explicit-test', CollabOrigin.Remote);
  doc.transact(() => {
    executeOperations(root, [() => root.set('nested-test', true)], 'nested-test');
  }, null);
  expect(origins).toEqual([CollabOrigin.Remote, null]);
  doc.destroy();
});
