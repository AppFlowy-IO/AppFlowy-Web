import { DatabaseViewLayout, View, ViewLayout } from '@/application/types';

import { prepareDefaultPage, usesDefaultPageCreation } from '../page-default-creation';

const parent = (extra: Partial<View> = {}): View => ({
  view_id: 'parent', name: '', layout: ViewLayout.Document, is_space: true, extra: null,
  children: [], icon: null, is_private: false, is_published: false, ...extra,
});
const ids = () => { let id = 0; return () => `identity-${++id}`; };

describe('server-owned page recipes', () => {
  it('retains a supplied document ID and requests no collab schema bytes', () => {
    const result = prepareDefaultPage('workspace', parent(), { layout: ViewLayout.Document, view_id: 'document', name: '' }, ids());

    expect(result).toEqual({ kind: 'document', selectedViewId: 'document', request: {
      schema_version: 'v1', request_id: 'identity-1', view_id: 'document', parent_view_id: 'parent', name: '', position: { kind: 'start' },
    } });
    expect(JSON.stringify(result.request)).not.toMatch(/encoded_collab|page_data|doc_state/);
  });

  it.each([
    [ViewLayout.Grid, DatabaseViewLayout.Grid, 3], [ViewLayout.Board, DatabaseViewLayout.Board, 3],
    [ViewLayout.Calendar, DatabaseViewLayout.Calendar, 0], [ViewLayout.Chart, DatabaseViewLayout.Chart, 3],
    [ViewLayout.List, DatabaseViewLayout.List, 3], [ViewLayout.Gallery, DatabaseViewLayout.Gallery, 3],
    [ViewLayout.Feed, DatabaseViewLayout.Feed, 3], [ViewLayout.Form, DatabaseViewLayout.Form, 0],
    [ViewLayout.Timeline, DatabaseViewLayout.Timeline, 0],
  ])('maps Folder layout %s to its server recipe without a temporary Grid', (layout, wireLayout, rowCount) => {
    const result = prepareDefaultPage('workspace', parent(), { layout }, ids(), 'Asia/Shanghai');

    if (result.kind !== 'database') throw new Error('expected database');
    expect(result.request.database.layout).toBe(wireLayout);
    expect(result.request.database.initial_row_ids).toHaveLength(rowCount);
    expect(result.request.database.timezone_id).toBe([ViewLayout.Calendar, ViewLayout.Timeline].includes(layout) ? 'Asia/Shanghai' : null);
    expect(Boolean(result.request.database.responses_view_id)).toBe(layout === ViewLayout.Form);
    expect(result.selectedViewId).toBe(layout === ViewLayout.Form ? result.request.database.view_id : result.request.container_id);
    expect(result.request.database.embedded).toBe(false);
  });

  it('returns the mounted view for an embedded database and keeps the wrapper distinct', () => {
    const result = prepareDefaultPage('workspace', parent({ is_space: false }), { layout: ViewLayout.List }, ids());

    if (result.kind !== 'database') throw new Error('expected database');
    expect(result.request.database.embedded).toBe(true);
    expect(result.selectedViewId).toBe(result.request.database.view_id);
    expect(result.selectedViewId).not.toBe(result.request.container_id);
  });

  it('keeps workspace-root databases standalone and resolves insertion only against current siblings', () => {
    const result = prepareDefaultPage('workspace', parent({ view_id: 'workspace', is_space: false, children: [parent({ view_id: 'sibling' })] }), {
      layout: ViewLayout.Grid, prev_view_id: 'sibling',
    }, ids());

    if (result.kind !== 'database') throw new Error('expected database');
    expect(result.request.position).toEqual({ kind: 'end' });
    expect(result.request.database.embedded).toBe(false);
    expect(() => prepareDefaultPage('workspace', parent(), { layout: ViewLayout.Document, prev_view_id: 'gone' })).toThrow();
  });

  it.each([ViewLayout.Document, ViewLayout.Grid])('appends layout %s after all raw siblings, including trashed children', (layout) => {
    // The HTTP parent omits the trashed child retained in the Folder's raw order.
    const visibleParent = parent({ children: [parent({ view_id: 'B' }), parent({ view_id: 'C' })] });
    const result = prepareDefaultPage('workspace', visibleParent, { layout, prev_view_id: 'C' }, ids());

    expect(result.request.position).toEqual({ kind: 'end' });
  });

  it('keeps a middle sibling as an anchor instead of a filtered numeric index', () => {
    const visibleParent = parent({ children: [parent({ view_id: 'B' }), parent({ view_id: 'C' })] });
    const result = prepareDefaultPage('workspace', visibleParent, {
      layout: ViewLayout.Document, prev_view_id: 'B',
    }, ids());

    expect(result.request.position).toEqual({ kind: 'after', view_id: 'B' });
  });

  it('does not silently discard supplied authored data or route AI chats into default Documents', () => {
    expect(usesDefaultPageCreation({ layout: ViewLayout.Document, page_data: { children: [] } })).toBe(false);
    expect(usesDefaultPageCreation({ layout: ViewLayout.AIChat })).toBe(false);
  });
});
