import { describe, expect, it } from '@jest/globals';

import {
  createRowDocumentViewNameBaseline,
  normalizeRowDocumentViewName,
  shouldSyncRowDocumentViewName,
} from '../rowDocumentViewName';

describe('row document view name sync', () => {
  it('syncs the first non-empty title when the initial title was blank', () => {
    const initialTitle = normalizeRowDocumentViewName('   ');

    expect(shouldSyncRowDocumentViewName(initialTitle, 'First title')).toBe(true);
  });

  it('treats an existing initial title as the baseline', () => {
    const initialTitle = normalizeRowDocumentViewName('Existing title');

    expect(shouldSyncRowDocumentViewName(initialTitle, 'Existing title')).toBe(false);
    expect(shouldSyncRowDocumentViewName(initialTitle, 'Renamed title')).toBe(true);
  });

  it('does not sync an empty title', () => {
    expect(shouldSyncRowDocumentViewName('Existing title', '   ')).toBe(false);
  });

  it('creates an independent baseline when the document changes', () => {
    const first = createRowDocumentViewNameBaseline('document-1', 'First row');
    const second = createRowDocumentViewNameBaseline('document-2', '   ');

    expect(first).toEqual({ documentId: 'document-1', title: 'First row' });
    expect(second).toEqual({ documentId: 'document-2', title: '' });
    expect(shouldSyncRowDocumentViewName(second.title, 'Second row')).toBe(true);
  });
});
