/** @jest-environment node */
import * as Y from 'yjs';

import { createBlock, getBlock, getChildrenArray, getText, updateBlockParent } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YSharedRoot } from '@/application/types';

import { createFirstBodyDraft } from '../first-body-actions';
import { applyFirstBodyStaging, FirstBodyStaging } from '../first-body-staging';

const id = '6e91148b-e42a-56b1-b9a0-58fbaa31552d';
function fixture() {
  const doc = createFirstBodyDraft(id);
  const root = doc.getMap('data') as YSharedRoot;
  const page = getBlock(root.get('document').get('page_id'), root);
  const paragraph = getBlock(getChildrenArray(page.get('children'), root).get(0), root);
  const text = getText(paragraph.get('external_id'), root);

  text.insert(0, 'first');
  return { doc, root, page, paragraph, text };
}

it('durable staged direct-Yjs bookmark conversion and nested blocks replay once after reopening', () => {
  const draft = fixture();
  let saved = '';
  const staging = new FirstBodyStaging(draft.doc, (json) => {
    saved = json;
  });

  draft.doc.transact(() => {
    draft.paragraph.set('ty', BlockType.BookmarkBlock);
    draft.paragraph.set('data', JSON.stringify({ url: 'https://example.com' }));
    const nested = createBlock(draft.root, { ty: BlockType.Paragraph, data: {} });

    updateBlockParent(draft.root, nested, draft.paragraph, 0);
    getText(nested.get('external_id'), draft.root).insert(0, 'kept after close', { bold: true });
  });
  staging.stop();
  draft.doc.destroy();
  const canonical = fixture(); // Independent client clocks, like a server-created body.

  applyFirstBodyStaging(canonical.doc, saved);
  const once = Y.encodeStateAsUpdate(canonical.doc);

  applyFirstBodyStaging(canonical.doc, saved);
  expect(Y.encodeStateAsUpdate(canonical.doc)).toEqual(once);
  expect(canonical.paragraph.get('ty')).toBe(BlockType.BookmarkBlock);
  expect(JSON.stringify(canonical.root.toJSON())).toContain('kept after close');
});

it('preserves unrelated peer content and rejects touched text conflicts before any live mutation', () => {
  const draft = fixture();
  const staging = new FirstBodyStaging(draft.doc, () => undefined);

  draft.text.insert(draft.text.length, ' continued');
  draft.paragraph.set('data', '{"align":"center"}');
  const canonical = fixture();
  const extra = createBlock(canonical.root, { ty: BlockType.Paragraph, data: {} });

  updateBlockParent(canonical.root, extra, canonical.page, 1);
  getText(extra.get('external_id'), canonical.root).insert(0, 'peer content');
  applyFirstBodyStaging(canonical.doc, staging.json);
  expect(getText(extra.get('external_id'), canonical.root).toString()).toBe('peer content');
  const conflicting = fixture();

  conflicting.text.insert(0, 'peer ');
  const before = Y.encodeStateAsUpdate(conflicting.doc);

  expect(() => applyFirstBodyStaging(conflicting.doc, staging.json)).toThrow('another device');
  expect(Y.encodeStateAsUpdate(conflicting.doc)).toEqual(before);
  staging.stop();
});

it('deterministically remaps a colliding post-seal block without changing the peer block on retry', () => {
  const draft = fixture();
  const second = createBlock(draft.root, { ty: BlockType.Paragraph, data: {} });

  updateBlockParent(draft.root, second, draft.page, 1);
  const canonical = new Y.Doc({ guid: id });

  Y.applyUpdate(canonical, Y.encodeStateAsUpdate(draft.doc));
  const root = canonical.getMap('data') as YSharedRoot;
  const staging = new FirstBodyStaging(draft.doc, () => undefined);
  const added = createBlock(draft.root, { ty: BlockType.Paragraph, data: {} });

  updateBlockParent(draft.root, added, draft.paragraph, 0);
  getText(added.get('external_id'), draft.root).insert(0, 'new staged child');
  const collisionId = added.get('id');
  const peer = new Y.Map(Object.entries(added.toJSON()));
  const document = root.get('document');

  document.get('blocks').set(collisionId, peer);
  document.get('meta').get('children_map').set(collisionId, new Y.Array());
  document.get('meta').get('text_map').set(collisionId, new Y.Text('peer child'));
  updateBlockParent(root, peer, getBlock(second.get('id'), root), 0);
  applyFirstBodyStaging(canonical, staging.json);
  const newId = getChildrenArray(draft.paragraph.get('children'), root).get(0);

  expect(newId).not.toBe(collisionId);
  expect(getText(newId, root).toString()).toBe('new staged child');
  expect(getText(collisionId, root).toString()).toBe('peer child');
  const once = Y.encodeStateAsUpdate(canonical);

  applyFirstBodyStaging(canonical, staging.json);
  expect(Y.encodeStateAsUpdate(canonical)).toEqual(once);
  staging.stop();
});
