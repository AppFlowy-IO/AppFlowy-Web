import type { SourceEnvelope } from '../../server-contract';

export const cellId = 'cell:database-id:row-id:field-id';
export const databaseSource: SourceEnvelope = {
  schemaVersion: 1, revision: 'revision', title: 'Lab',
  sources: [{ pageId: 'page', title: 'Lab', kind: 'document', revision: 'native', original: {} }],
  blocks: [], assets: [], dependencyRevisions: [], coverage: [],
  references: {
    [cellId]: { location: { kind: 'database_cell', pageId: 'page', databaseId: 'database-id', rowId: 'row-id', fieldId: 'field-id', revision: 'row-revision' }, evidenceKind: 'original', numeric: null },
  },
  databaseViews: [{
    databaseId: 'database-id', viewId: 'embedded-view', name: 'LLM Experiments', viewType: 'grid',
    selectedTab: null, filters: null, sorts: null, groups: null,
    schema: { fields: [
      { id: 'title-id', name: 'Experiment', is_primary: true },
      { id: 'field-id', name: 'Passing answers', is_primary: false },
    ] },
    coverage: { sourceId: null, status: 'included', total: 1, matched: 1, included: 1, selection: null, warning: null },
    rows: [{ rowId: 'row-id', revision: 'row-revision', cells: {
      'title-id': { sourceId: 'title-source', value: { type: 'text', text: 'v4 Hard examples', annotations: null } },
      'field-id': { sourceId: cellId, value: { type: 'number', value: 88, unit: '' } },
    } }],
  }],
};
