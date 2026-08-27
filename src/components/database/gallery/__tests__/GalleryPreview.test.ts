import * as Y from 'yjs';

import {
  createBlock,
  getBlock,
  getPageId,
  initializeDocumentStructure,
  updateBlockParent,
} from '@/application/slate-yjs/utils/yjs';
import { BlockType, YDoc, YSharedRoot, YjsEditorKey } from '@/application/types';

import { findFirstDocumentImage } from '../GalleryPreview';

function documentFixture() {
  const doc = new Y.Doc() as unknown as YDoc;

  initializeDocumentStructure(doc);
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const page = getBlock(getPageId(sharedRoot), sharedRoot);

  return { page, sharedRoot };
}

describe('Gallery Page content preview', () => {
  it('finds the first image recursively in document order', () => {
    const { page, sharedRoot } = documentFixture();
    const container = createBlock(sharedRoot, { data: {}, ty: BlockType.Paragraph });
    const nestedImage = createBlock(sharedRoot, {
      data: { url: 'https://example.com/nested.png' },
      ty: BlockType.ImageBlock,
    });
    const laterImage = createBlock(sharedRoot, {
      data: { url: 'https://example.com/later.png' },
      ty: BlockType.ImageBlock,
    });

    updateBlockParent(sharedRoot, container, page, 0);
    updateBlockParent(sharedRoot, nestedImage, container, 0);
    updateBlockParent(sharedRoot, laterImage, page, 1);

    expect(findFirstDocumentImage(sharedRoot)).toBe('https://example.com/nested.png');
  });

  it('uses the first valid image inside a photo-gallery block', () => {
    const { page, sharedRoot } = documentFixture();
    const gallery = createBlock(sharedRoot, {
      data: {
        images: [{ url: '' }, { url: 'https://example.com/gallery.png' }, { url: 'https://example.com/last.png' }],
        layout: 0,
      },
      ty: BlockType.GalleryBlock,
    });

    updateBlockParent(sharedRoot, gallery, page, 0);
    expect(findFirstDocumentImage(sharedRoot)).toBe('https://example.com/gallery.png');
  });

  it('returns null for empty and partially initialized documents', () => {
    const { sharedRoot } = documentFixture();
    const partial = new Y.Doc().getMap(YjsEditorKey.data_section) as YSharedRoot;

    expect(findFirstDocumentImage(sharedRoot)).toBeNull();
    expect(findFirstDocumentImage(partial)).toBeNull();
  });
});
