import { renderHook, waitFor } from '@testing-library/react';

import { parseRelationTypeOption, useDatabaseContext, useFieldSelector } from '@/application/database-yjs';
import { getMultiple as getViews, listDatabases } from '@/application/services/domains/view';
import { ViewLayout } from '@/application/types';

import { clearRelationViewsCache, useRelationData } from './useRelationData';

const updateTypeOption = jest.fn();

jest.mock('@/application/database-yjs', () => ({
  parseRelationTypeOption: jest.fn(),
  useDatabaseContext: jest.fn(),
  useFieldSelector: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch/relation', () => ({
  useUpdateRelationTypeOption: () => updateTypeOption,
}));

jest.mock('@/application/services/domains/view', () => ({
  getMultiple: jest.fn(),
  listDatabases: jest.fn(),
}));

describe('useRelationData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRelationViewsCache();
    jest.mocked(getViews).mockResolvedValue([]);
    jest.mocked(useFieldSelector).mockReturnValue({ field: {} } as never);
    jest.mocked(parseRelationTypeOption).mockReturnValue({ database_id: 'database-1' } as never);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadDatabaseRelations: jest.fn().mockResolvedValue({}),
      loadViews: jest.fn().mockResolvedValue([]),
    } as never);
    jest.mocked(listDatabases).mockResolvedValue([
      {
        database_id: 'database-1',
        views: [
          {
            view_id: 'container-1',
            layout: ViewLayout.Grid,
            is_container: true,
            embedded: false,
            name: 'Projects',
            icon: null,
            parent_view_id: null,
          },
          {
            view_id: 'grid-1',
            layout: ViewLayout.Grid,
            is_container: false,
            embedded: false,
            name: 'Grid',
            icon: null,
            parent_view_id: 'container-1',
          },
        ],
      },
    ]);
  });

  it('loads relation configuration choices from the new database-list API', async () => {
    const { result } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listDatabases).toHaveBeenCalledWith('workspace-1');
    expect(result.current.databaseCandidates).toEqual([
      expect.objectContaining({
        databaseId: 'database-1',
        viewId: 'grid-1',
        displayView: expect.objectContaining({ name: 'Projects' }),
      }),
    ]);
    expect(result.current.selectedView?.name).toBe('Projects');
  });
});
