import { DATABASE_BLOCK_TYPES } from '@/application/database-block';
import { normalizePublishedPageSnapshot } from '@/application/publish-snapshot/normalize';
import {
  publishedDatabasePayload,
  publishedDocumentPayload,
} from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';
import { BlockType } from '@/application/types';

import { shouldDisableFixedGlobalCommentInput } from '../comment';

describe('shouldDisableFixedGlobalCommentInput', () => {
  it('disables fixed comments for published database pages', () => {
    expect(shouldDisableFixedGlobalCommentInput(normalizePublishedPageSnapshot(publishedDatabasePayload))).toBe(true);
  });

  it('keeps fixed comments for normal published documents', () => {
    expect(shouldDisableFixedGlobalCommentInput(normalizePublishedPageSnapshot(publishedDocumentPayload))).toBe(false);
  });

  it.each(DATABASE_BLOCK_TYPES)(
    'disables fixed comments for published documents with %s blocks in raw data',
    (blockType) => {
      const snapshot = normalizePublishedPageSnapshot({
        ...publishedDocumentPayload,
        document: {
          ...publishedDocumentPayload.document,
          raw: {
            data: {
              page_id: 'page-id',
              blocks: {
                'page-id': {
                  id: 'page-id',
                  ty: BlockType.Page,
                  children: 'page-id',
                },
                'database-block-id': {
                  id: 'database-block-id',
                  ty: blockType,
                  parent: 'page-id',
                  children: 'database-block-id',
                },
              },
              meta: {},
            },
          },
        },
      });

      expect(shouldDisableFixedGlobalCommentInput(snapshot)).toBe(true);
    }
  );

  it.each(DATABASE_BLOCK_TYPES)(
    'disables fixed comments for published documents with %s blocks in slate children',
    (blockType) => {
      const snapshot = normalizePublishedPageSnapshot({
        ...publishedDocumentPayload,
        document: {
          children: [
            {
              type: blockType,
              blockId: 'database-block-id',
              data: {},
              children: [{ text: '' }],
            },
          ],
        },
      });

      expect(shouldDisableFixedGlobalCommentInput(snapshot)).toBe(true);
    }
  );
});
