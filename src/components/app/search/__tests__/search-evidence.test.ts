import { describe, expect, it, jest } from '@jest/globals';

import type { SearchDocumentResponseItem, SearchEvidence } from '@/application/services/domains/search';

import { describeEvidence, evidenceBlockId, primaryEvidence } from '../search-evidence';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: () => 'https://cloud.example',
}));

function evidence(overrides: Partial<SearchEvidence> = {}): SearchEvidence {
  return {
    kind: 'image',
    processor_id: 'image_understanding',
    resource_id: 'image-block',
    locator: { workspace_id: 'workspace-id', parent_dir: 'page-id', file_id: 'chart.png' },
    matched_text: '  Quarterly revenue chart  ',
    ...overrides,
  };
}

function item(overrides: Partial<SearchDocumentResponseItem> = {}): SearchDocumentResponseItem {
  return {
    object_id: 'page-id',
    workspace_id: 'workspace-id',
    score: 1,
    content: '',
    ...overrides,
  };
}

describe('search evidence', () => {
  it('prefers an image over a PDF and ignores results without evidence', () => {
    const pdf = evidence({ kind: 'pdf', processor_id: 'native_pdf' });
    const image = evidence();

    expect(primaryEvidence(item({ evidence: [pdf, image] }))).toBe(image);
    expect(primaryEvidence(item({ evidence: [pdf] }))).toBe(pdf);
    expect(primaryEvidence(item())).toBeUndefined();
  });

  it('shows the matched text and a thumbnail of a private image', () => {
    expect(describeEvidence(evidence())).toEqual({
      kind: 'image',
      matchedText: 'Quarterly revenue chart',
      imageUrl: 'https://cloud.example/api/file_storage/workspace-id/v1/blob/page-id/chart.png',
    });
    const published = evidence({
      locator: { workspace_id: 'workspace-id', parent_dir: 'page-id', file_id: 'chart.png', is_public: true },
    });

    expect(describeEvidence(published).imageUrl).toBeUndefined();
    expect(describeEvidence(evidence({ kind: 'pdf', matched_text: null }))).toEqual({ kind: 'pdf' });
  });

  it('opens a page at the matched image block, and a row as a row', () => {
    expect(evidenceBlockId(item(), evidence())).toBe('image-block');
    // A gallery image is `<block id>:<index>`.
    expect(evidenceBlockId(item(), evidence({ resource_id: 'gallery-block:2' }))).toBe('gallery-block');
    expect(
      evidenceBlockId(item({ database_row_id: 'row-id' }), evidence({ resource_id: 'field:file' }))
    ).toBeUndefined();
    expect(evidenceBlockId(item(), evidence({ kind: 'pdf' }))).toBeUndefined();
    expect(evidenceBlockId(item(), undefined)).toBeUndefined();
  });
});
