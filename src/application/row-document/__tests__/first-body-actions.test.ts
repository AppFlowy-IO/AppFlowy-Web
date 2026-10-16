/** @jest-environment node */
import * as Y from 'yjs';

import { createBlock, getBlock, getChildrenArray, getText, updateBlockParent } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YjsEditorKey, YSharedRoot } from '@/application/types';

import { compileFirstBodyActions, createFirstBodyDraft, hasFirstBodyContent } from '../first-body-actions';

const documentId = '6e91148b-e42a-56b1-b9a0-58fbaa31552d';
const setup = () => {
  const doc = createFirstBodyDraft(documentId);
  const root = doc.getMap('data') as YSharedRoot;
  const document = root.get('document');
  const page = getBlock(document.get('page_id'), root);
  const paragraph = getBlock(getChildrenArray(page.get('children'), root).get(0), root);

  return { doc, root, document, page, paragraph, text: getText(paragraph.get('external_id'), root) };
};

describe('first row-page native action compiler', () => {
  it('uses the server v1 deterministic root and structural-only blank', () => {
    const { doc, page, paragraph } = setup();

    expect(page.get('id')).toBe('69d1e3fb-c2f3-5156-b8e3-636273bad252');
    expect(page.get('external_id')).toBeUndefined();
    expect(hasFirstBodyContent(doc)).toBe(false);
    const contribution = compileFirstBodyActions(doc);

    expect(contribution.kind).toBe('default_actions');
    expect(contribution.schema_version).toBe('v1');
    expect(contribution.actions.map(({ action }) => action)).toEqual(['Delete', 'Insert', 'InsertText']);
    expect(contribution.actions[0].payload.block?.id).toBe(paragraph.get('id'));
    expect(contribution.actions[2].payload.delta).toBe('[]');
  });

  it('preserves complete sibling order, nested empty text, marks and media data', () => {
    const { doc, root, page, paragraph, text } = setup();

    text.applyDelta([{ insert: 'first', attributes: { bold: true } }, { insert: ' last' }]);
    const list = createBlock(root, { ty: BlockType.BulletedListBlock, data: { level: 1 } });

    updateBlockParent(root, list, page, 1);
    const child = createBlock(root, { ty: BlockType.Paragraph, data: {} });

    updateBlockParent(root, child, list, 0);
    const image = createBlock(root, {
      ty: BlockType.ImageBlock,
      data: { url: 'https://example.test/image', width: 512 },
    });

    updateBlockParent(root, image, page, 2);
    const actions = compileFirstBodyActions(doc).actions;
    const inserted = actions.filter(({ action }) => action === 'Insert');

    expect(inserted.map(({ payload }) => payload.block?.id)).toEqual([
      paragraph.get('id'),
      list.get('id'),
      child.get('id'),
      image.get('id'),
    ]);
    expect(inserted.map(({ payload }) => payload.prev_id)).toEqual([null, paragraph.get('id'), null, list.get('id')]);
    expect(actions.find(({ payload }) => payload.text_id === paragraph.get('external_id'))?.payload.delta).toBe(
      JSON.stringify(text.toDelta())
    );
    expect(actions.find(({ payload }) => payload.text_id === child.get('external_id'))?.payload.delta).toBe('[]');
    expect(inserted[3].payload.block?.data).toEqual({ url: 'https://example.test/image', width: 512 });
    expect(actions.every(({ payload }) => payload.update_type === false)).toBe(true);
  });

  it.each([BlockType.GridBlock, BlockType.FeedBlock, BlockType.SubpageBlock])('refuses owned graph type %s', (type) => {
    const { doc, paragraph } = setup();

    paragraph.set(YjsEditorKey.block_type, type);
    expect(() => compileFirstBodyActions(doc)).toThrow('compound');
  });

  it('refuses dangling edges, unreachable content, malformed metadata and unfinished uploads', () => {
    for (const mutate of [
      ({ page, root }: ReturnType<typeof setup>) => getChildrenArray(page.get('children'), root).push(['missing']),
      ({ root }: ReturnType<typeof setup>) => createBlock(root, { ty: BlockType.Paragraph, data: {} }),
      ({ paragraph }: ReturnType<typeof setup>) => paragraph.set(YjsEditorKey.block_data, 'broken'),
      ({ paragraph }: ReturnType<typeof setup>) =>
        paragraph.set(YjsEditorKey.block_data, '{"pending_upload_id":"pending"}'),
    ]) {
      const fixture = setup();

      mutate(fixture);
      expect(() => compileFirstBodyActions(fixture.doc)).toThrow('Invalid first row-page body');
    }
  });

  it('refuses cycles, mismatched parent, orphan text, unresolved mention and oversized actions', () => {
    for (const mutate of [
      ({ paragraph, root }: ReturnType<typeof setup>) =>
        getChildrenArray(paragraph.get('children'), root).push([paragraph.get('id')]),
      ({ paragraph }: ReturnType<typeof setup>) => paragraph.set(YjsEditorKey.block_parent, 'wrong'),
      ({ document }: ReturnType<typeof setup>) =>
        document.get('meta').get('text_map').set('orphan', new Y.Text('orphan')),
      ({ text }: ReturnType<typeof setup>) => text.insert(0, 'mention', { mention: { block_id: 'missing' } }),
      ({ text }: ReturnType<typeof setup>) => text.insert(0, 'x'.repeat(4 * 1024 * 1024)),
    ]) {
      const fixture = setup();

      mutate(fixture);
      expect(() => compileFirstBodyActions(fixture.doc)).toThrow('Invalid first row-page body');
    }
  });
});
