import * as Y from 'yjs';

import { YjsEditorKey } from '@/application/types';

import { decodeTemplateDocumentSnapshot, encodeTemplateDocumentSnapshot } from '../document';

import fixture from './fixtures/row_template_interop.json';

describe('Desktop document snapshots', () => {
  it('decodes real Rust protobuf bytes into a Yjs document with text, attributes, and child order', () => {
    const snapshot = decodeTemplateDocumentSnapshot(Array.from(Buffer.from(fixture.document_snapshot, 'base64')))!;
    const doc = new Y.Doc();

    Y.applyUpdate(doc, Buffer.from(snapshot.encodedState, 'base64'));
    const document = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.document) as Y.Map<unknown>;
    const meta = document.get(YjsEditorKey.meta) as Y.Map<Y.Map<unknown>>;
    const texts = meta.get(YjsEditorKey.text_map) as Y.Map<Y.Text>;
    const children = meta.get(YjsEditorKey.children_map) as Y.Map<Y.Array<string>>;

    expect(snapshot.isDocumentEmpty).toBe(false);
    expect(document.get(YjsEditorKey.page_id)).toBe('page');
    expect(children.get('page-children')?.toArray()).toEqual(['paragraph']);
    expect(texts.get('text')?.toDelta()).toEqual([{ insert: 'Saved snapshot 📘', attributes: { bold: true } }]);
    doc.destroy();
  });

  it('keeps absent legacy snapshots distinct from corrupt saved content', () => {
    expect(decodeTemplateDocumentSnapshot()).toBeUndefined();
    expect(decodeTemplateDocumentSnapshot([])).toBeUndefined();
    expect(() => decodeTemplateDocumentSnapshot([1, 2, 3])).toThrow('Invalid template document snapshot');
  });
});

test('freezes canonical legacy bodies without losing rich text or mutating the source', () => {
  const original = decodeTemplateDocumentSnapshot(Array.from(Buffer.from(fixture.document_snapshot, 'base64')))!;
  const doc = new Y.Doc();
  const restored = new Y.Doc();
  try {
    Y.applyUpdate(doc, Buffer.from(original.encodedState, 'base64'));
    const before = Y.encodeStateAsUpdate(doc);
    const snapshot = decodeTemplateDocumentSnapshot(encodeTemplateDocumentSnapshot(doc))!;
    Y.applyUpdate(restored, Buffer.from(snapshot.encodedState, 'base64'));
    expect(restored.getMap('data').toJSON()).toEqual(doc.getMap('data').toJSON());
    expect(snapshot.isDocumentEmpty).toBe(false);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally {
    doc.destroy();
    restored.destroy();
  }
});

test('does not freeze malformed or incomplete canonical document bodies', () => {
  const doc = new Y.Doc();
  try {
    expect(() => encodeTemplateDocumentSnapshot(doc)).toThrow('Invalid template document snapshot');
  } finally {
    doc.destroy();
  }
});
