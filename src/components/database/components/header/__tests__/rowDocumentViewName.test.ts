import { describe, expect, it } from '@jest/globals';

import {
  normalizeRowDocumentViewName,
  shouldSyncRowDocumentViewName,
} from '../rowDocumentViewName';

describe('row document view name sync', () => {
  it('syncs the first non-empty edited title', () => {
    expect(shouldSyncRowDocumentViewName('', 'First title')).toBe(true);
  });

  it('does not re-sync an unchanged title', () => {
    expect(shouldSyncRowDocumentViewName('Existing title', 'Existing title')).toBe(false);
    expect(shouldSyncRowDocumentViewName('Existing title', '  Existing title  ')).toBe(false);
    expect(shouldSyncRowDocumentViewName('Existing title', 'Renamed title')).toBe(true);
  });

  it('does not sync an empty title', () => {
    expect(shouldSyncRowDocumentViewName('Existing title', '   ')).toBe(false);
    expect(shouldSyncRowDocumentViewName('', '')).toBe(false);
  });

  it('normalizes surrounding whitespace', () => {
    expect(normalizeRowDocumentViewName('  padded  ')).toBe('padded');
  });
});
