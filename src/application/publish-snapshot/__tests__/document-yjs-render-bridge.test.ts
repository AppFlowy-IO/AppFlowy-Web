import { normalizePublishedPageSnapshot } from '@/application/publish-snapshot/normalize';
import {
  publishedDatabasePayload,
  publishedDocumentPayload,
  publishedRowDocumentId,
} from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';
import {
  createDocumentYjsRenderDocFromRawData,
  createDocumentYjsRenderDocFromSnapshot,
} from '@/application/publish-snapshot/document-yjs-render-bridge';
import { yDocToSlateContent } from '@/application/slate-yjs/utils/convert';

describe('createDocumentYjsRenderDocFromSnapshot', () => {
  it('builds a Yjs document for legacy render consumers from the published document JSON', () => {
    const snapshot = normalizePublishedPageSnapshot(publishedDocumentPayload);

    if (snapshot.kind !== 'document') {
      throw new Error('Expected document snapshot fixture');
    }

    const doc = createDocumentYjsRenderDocFromSnapshot(snapshot);
    const slateContent = yDocToSlateContent(doc);
    const firstBlock = slateContent?.children[0] as {
      blockId?: string;
      children?: Array<{ children?: Array<{ text?: string }> }>;
    } | undefined;

    expect(doc.guid).toBe(snapshot.view.viewId);
    expect(doc.object_id).toBe(snapshot.view.viewId);
    expect(doc.view_id).toBe(snapshot.view.viewId);
    expect(firstBlock?.blockId).toBe('published-document-block-id');
    expect(firstBlock?.children?.[0]?.children?.[0]?.text).toBe('Published document body');
  });

  it('builds a Yjs document from published raw document JSON', () => {
    const snapshot = normalizePublishedPageSnapshot(publishedDatabasePayload);

    if (snapshot.kind !== 'database') {
      throw new Error('Expected database snapshot fixture');
    }

    const doc = createDocumentYjsRenderDocFromRawData(
      publishedRowDocumentId,
      snapshot.database.raw.row_documents[publishedRowDocumentId]
    );
    const slateContent = yDocToSlateContent(doc);
    const firstBlock = slateContent?.children[0] as {
      blockId?: string;
      children?: Array<{ children?: Array<{ text?: string }> }>;
    } | undefined;

    expect(doc.guid).toBe(publishedRowDocumentId);
    expect(doc.object_id).toBe(publishedRowDocumentId);
    expect(doc.view_id).toBe(publishedRowDocumentId);
    expect(firstBlock?.blockId).toBe('published-row-document-block-id');
    expect(firstBlock?.children?.[0]?.children?.[0]?.text).toBe('Published row document body');
  });
});
