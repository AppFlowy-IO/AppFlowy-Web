import type { SearchDocumentResponseItem, SearchEvidence } from '@/application/services/domains/search';
import { getAppFlowyBlobUrl } from '@/utils/file-storage-url';

/** How a result matched through an image or PDF, as the result list shows it. */
export interface SearchResultEvidence {
  kind: SearchEvidence['kind'];
  /** The generated text that matched the query. */
  matchedText?: string;
  /** The matched image, shown as a thumbnail. */
  imageUrl?: string;
}

/** The evidence a result shows: an image before a PDF. */
export function primaryEvidence(item: SearchDocumentResponseItem): SearchEvidence | undefined {
  const evidence = item.evidence ?? [];

  return evidence.find((entry) => entry.kind === 'image') ?? evidence.find((entry) => entry.kind === 'pdf');
}

export function describeEvidence(evidence: SearchEvidence): SearchResultEvidence {
  const { locator } = evidence;

  return {
    kind: evidence.kind,
    matchedText: evidence.matched_text?.trim() || undefined,
    // Published files live in another namespace; the result keeps its text without a thumbnail.
    imageUrl:
      evidence.kind === 'image' && !locator.is_public
        ? getAppFlowyBlobUrl(locator.workspace_id, locator.parent_dir, locator.file_id)
        : undefined,
  };
}

/**
 * The block a page opens at for an image matched in it. A database row opens as a row instead, and
 * its images are named `<field id>:<file id>`, not by block.
 */
export function evidenceBlockId(
  item: SearchDocumentResponseItem,
  evidence: SearchEvidence | undefined
): string | undefined {
  if (evidence?.kind !== 'image' || item.database_row_id) return;
  // A gallery image is named `<block id>:<index>`.
  const [blockId] = evidence.resource_id.split(':');

  return blockId || undefined;
}
