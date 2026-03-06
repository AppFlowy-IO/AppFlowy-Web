/**
 * Tests for slash-panel utility functions.
 * These are pure functions and easy to test in isolation.
 */
import { collectSelectableDatabaseViews, filterViewsByDatabases } from '../slash-panel.utils';
import { View, ViewLayout } from '@/application/types';

const makeView = (id: string, layout: ViewLayout, overrides: Partial<View> = {}): View => ({
  view_id: id,
  name: id,
  layout,
  children: [],
  ...overrides,
} as View);

describe('filterViewsByDatabases', () => {
  const grid1 = makeView('grid1', ViewLayout.Grid);
  const grid2 = makeView('grid2', ViewLayout.Grid, { name: 'Sales Grid' });
  const doc = makeView('doc1', ViewLayout.Document, { children: [grid2] });

  it('returns empty array for empty views', () => {
    expect(filterViewsByDatabases([], new Set(['grid1']), '')).toEqual([]);
  });

  it('includes views that are in allowedIds with no keyword filter', () => {
    const result = filterViewsByDatabases([grid1], new Set(['grid1']), '');
    expect(result).toHaveLength(1);
    expect(result[0].view_id).toBe('grid1');
  });

  it('filters by keyword (case-insensitive)', () => {
    const result = filterViewsByDatabases([grid1, doc], new Set(['grid1', 'grid2']), 'sales');
    // Only doc (which contains grid2 named "Sales Grid") should match
    expect(result).toHaveLength(1);
    expect(result[0].view_id).toBe('doc1');
    expect(result[0].children[0].view_id).toBe('grid2');
  });

  it('excludes views not in allowedIds', () => {
    const result = filterViewsByDatabases([grid1], new Set(['grid2']), '');
    expect(result).toHaveLength(0);
  });

  it('includes parent when child matches keyword', () => {
    const result = filterViewsByDatabases([doc], new Set(['grid2']), 'Sales');
    expect(result[0].view_id).toBe('doc1');
    expect(result[0].children[0].view_id).toBe('grid2');
  });
});

describe('collectSelectableDatabaseViews', () => {
  it('returns empty for empty views', () => {
    expect(collectSelectableDatabaseViews([])).toEqual([]);
  });

  it('collects database containers', () => {
    const container = makeView('c1', ViewLayout.Grid, { extra: { is_database_container: true } });
    const result = collectSelectableDatabaseViews([container]);
    expect(result.map(v => v.view_id)).toContain('c1');
  });

  it('collects legacy top-level databases (not embedded, not child of db)', () => {
    const legacy = makeView('legacy1', ViewLayout.Grid);
    const result = collectSelectableDatabaseViews([legacy]);
    expect(result.map(v => v.view_id)).toContain('legacy1');
  });

  it('does NOT collect embedded databases', () => {
    const embedded = makeView('emb1', ViewLayout.Grid, { extra: { embedded: true } });
    const result = collectSelectableDatabaseViews([embedded]);
    expect(result.map(v => v.view_id)).not.toContain('emb1');
  });

  it('does NOT collect child databases of a parent database', () => {
    const child = makeView('child1', ViewLayout.Grid);
    const parent = makeView('parent1', ViewLayout.Grid, {
      extra: { is_database_container: true },
      children: [child],
    });
    const result = collectSelectableDatabaseViews([parent]);
    // parent should be collected, child should NOT
    expect(result.map(v => v.view_id)).toContain('parent1');
    expect(result.map(v => v.view_id)).not.toContain('child1');
  });
});
