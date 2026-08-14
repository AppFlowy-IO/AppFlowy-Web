import { addViewId, createDatabaseNodeData, removeViewId, serializeDatabaseNodeData } from '../databaseBlockUtils';

describe('database block view ID compatibility', () => {
  it('creates the canonical cross-client payload with both ID representations', () => {
    expect(
      createDatabaseNodeData({
        parentId: 'document-id',
        viewIds: ['list-view', 'list-view', 'board-view'],
        databaseId: 'database-id',
      })
    ).toEqual({
      parent_id: 'document-id',
      view_ids: ['list-view', 'board-view'],
      view_id: 'list-view',
      database_id: 'database-id',
    });
  });

  it('keeps the legacy primary view ID synchronized while adding and removing views', () => {
    const initial = createDatabaseNodeData({ parentId: 'document-id', viewIds: ['list-view'] });
    const added = addViewId(initial, 'board-view');

    expect(added).toMatchObject({
      view_ids: ['list-view', 'board-view'],
      view_id: 'list-view',
    });

    const promoted = removeViewId(added, 'list-view');

    expect(promoted).toMatchObject({
      view_ids: ['board-view'],
      view_id: 'board-view',
    });

    const empty = removeViewId(promoted, 'board-view');

    expect(empty.view_ids).toEqual([]);
    expect(empty.view_id).toBeUndefined();
    expect(serializeDatabaseNodeData(empty)).not.toContain('"view_id":');
  });
});
