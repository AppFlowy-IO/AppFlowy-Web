import * as Y from 'yjs';

import { YjsEditorKey } from '@/application/types';

import { decodeTemplateDocumentSnapshot } from '../document';

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
    expect(texts.get('text')?.toDelta()).toEqual([
      { insert: 'Saved snapshot 📘', attributes: { bold: true } },
    ]);
    doc.destroy();
  });

  it('keeps absent legacy snapshots distinct from corrupt saved content', () => {
    expect(decodeTemplateDocumentSnapshot()).toBeUndefined();
    expect(decodeTemplateDocumentSnapshot([])).toBeUndefined();
    expect(() => decodeTemplateDocumentSnapshot([1, 2, 3])).toThrow('Invalid template document snapshot');
  });
});
