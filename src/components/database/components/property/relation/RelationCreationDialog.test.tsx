import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useDatabaseContext } from '@/application/database-yjs';
import { getMultiple as getViews } from '@/application/services/domains/view';
import { View, ViewLayout } from '@/application/types';
import { RelationCreationDialog } from '@/components/database/components/property/relation/RelationCreationDialog';

import type { ReactNode } from 'react';

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: jest.fn(),
}));

jest.mock('@/application/services/domains/view', () => ({
  getMultiple: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-testid='relation-modal'>{children}</div> : null,
}));

jest.mock('@/components/database/components/property/relation/RelationView', () => ({
  RelationView: ({ view }: { view: View }) => <span>{view.name}</span>,
}));

function makeView({
  viewId,
  name,
  databaseId,
  parentViewId,
  isContainer = false,
}: {
  viewId: string;
  name: string;
  databaseId: string;
  parentViewId?: string;
  isContainer?: boolean;
}): View {
  return {
    view_id: viewId,
    parent_view_id: parentViewId,
    name,
    layout: ViewLayout.Grid,
    children: [],
    icon: null,
    extra: {
      database_id: databaseId,
      is_database_container: isContainer,
    },
    is_published: false,
    is_private: false,
  };
}

describe('RelationCreationDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders and searches relation targets by database container name', async () => {
    const currentGrid = makeView({
      viewId: 'current-grid',
      name: 'Grid',
      databaseId: 'current-database',
      parentViewId: 'current-container',
    });
    const currentContainer = makeView({
      viewId: 'current-container',
      name: 'To-dos',
      databaseId: 'current-database',
      isContainer: true,
    });
    const relatedGrid = makeView({
      viewId: 'related-grid',
      name: 'Grid',
      databaseId: 'related-database',
      parentViewId: 'related-container',
    });
    const relatedContainer = makeView({
      viewId: 'related-container',
      name: 'Product roadmap',
      databaseId: 'related-database',
      isContainer: true,
    });
    const viewsById: Record<string, View> = {
      [currentGrid.view_id]: currentGrid,
      [currentContainer.view_id]: currentContainer,
      [relatedGrid.view_id]: relatedGrid,
      [relatedContainer.view_id]: relatedContainer,
    };
    const loadViewMeta = jest.fn(async (viewId: string) => viewsById[viewId] ?? null);

    (getViews as jest.MockedFunction<typeof getViews>).mockImplementation(async (_workspaceId, viewIds) => {
      return viewIds.map((viewId) => viewsById[viewId]).filter((view): view is View => Boolean(view));
    });

    (useDatabaseContext as jest.Mock).mockReturnValue({
      workspaceId: 'workspace-1',
      databaseDoc: { guid: 'current-database' },
      databasePageId: currentGrid.view_id,
      loadDatabaseRelations: jest.fn().mockResolvedValue({
        'current-database': currentGrid.view_id,
        'related-database': relatedGrid.view_id,
      }),
      loadViewMeta,
    });

    render(
      <RelationCreationDialog
        open
        initialFieldName='Relation'
        onOpenChange={jest.fn()}
        onCreate={jest.fn()}
      />
    );

    const currentCandidate = await screen.findByTestId('relation-candidate-current-database');
    const relatedCandidate = await screen.findByTestId('relation-candidate-related-database');

    expect(currentCandidate.textContent).toContain('To-dos');
    expect(relatedCandidate.textContent).toContain('Product roadmap');
    expect(currentCandidate.textContent).not.toContain('Grid');
    expect(relatedCandidate.textContent).not.toContain('Grid');

    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'roadmap' } });

    await waitFor(() => {
      expect(screen.queryByTestId('relation-candidate-current-database')).toBeNull();
      expect(screen.queryByTestId('relation-candidate-related-database')).not.toBeNull();
    });

    expect(getViews).toHaveBeenNthCalledWith(
      1,
      'workspace-1',
      [currentGrid.view_id, relatedGrid.view_id],
      0
    );
    expect(getViews).toHaveBeenNthCalledWith(
      2,
      'workspace-1',
      [currentContainer.view_id, relatedContainer.view_id],
      0
    );
    expect(loadViewMeta).not.toHaveBeenCalled();
  });

  it('uses the database container name when opened from a secondary view', async () => {
    const currentGrid = makeView({
      viewId: 'current-grid',
      name: 'Grid',
      databaseId: 'current-database',
      parentViewId: 'current-container',
    });
    const currentBoard = makeView({
      viewId: 'current-board',
      name: 'Board',
      databaseId: 'current-database',
      parentViewId: 'current-container',
    });
    const currentContainer = makeView({
      viewId: 'current-container',
      name: 'To-dos',
      databaseId: 'current-database',
      isContainer: true,
    });
    const relatedGrid = makeView({
      viewId: 'related-grid',
      name: 'Grid',
      databaseId: 'related-database',
      parentViewId: 'related-container',
    });
    const relatedContainer = makeView({
      viewId: 'related-container',
      name: 'Product roadmap',
      databaseId: 'related-database',
      isContainer: true,
    });
    const viewsById: Record<string, View> = {
      [currentGrid.view_id]: currentGrid,
      [currentBoard.view_id]: currentBoard,
      [currentContainer.view_id]: currentContainer,
      [relatedGrid.view_id]: relatedGrid,
      [relatedContainer.view_id]: relatedContainer,
    };

    (getViews as jest.MockedFunction<typeof getViews>).mockImplementation(async (_workspaceId, viewIds) => {
      return viewIds.map((viewId) => viewsById[viewId]).filter((view): view is View => Boolean(view));
    });

    (useDatabaseContext as jest.Mock).mockReturnValue({
      workspaceId: 'workspace-1',
      databaseDoc: { guid: 'current-database' },
      databasePageId: currentBoard.view_id,
      loadDatabaseRelations: jest.fn().mockResolvedValue({
        'current-database': currentGrid.view_id,
        'related-database': relatedGrid.view_id,
      }),
      loadViewMeta: jest.fn(async (viewId: string) => viewsById[viewId] ?? null),
    });

    render(
      <RelationCreationDialog
        open
        initialFieldName='Relation'
        onOpenChange={jest.fn()}
        onCreate={jest.fn()}
      />
    );

    await screen.findByTestId('relation-candidate-related-database');

    expect(screen.queryByText('This database')).toBeNull();
    expect(screen.getAllByText('To-dos')).toHaveLength(2);
  });

  it('falls back to individual view metadata when batch loading is unavailable', async () => {
    const currentGrid = makeView({
      viewId: 'current-grid',
      name: 'Grid',
      databaseId: 'current-database',
      parentViewId: 'current-container',
    });
    const currentContainer = makeView({
      viewId: 'current-container',
      name: 'To-dos',
      databaseId: 'current-database',
      isContainer: true,
    });
    const relatedGrid = makeView({
      viewId: 'related-grid',
      name: 'Grid',
      databaseId: 'related-database',
      parentViewId: 'related-container',
    });
    const relatedContainer = makeView({
      viewId: 'related-container',
      name: 'Product roadmap',
      databaseId: 'related-database',
      isContainer: true,
    });
    const viewsById: Record<string, View> = {
      [currentGrid.view_id]: currentGrid,
      [currentContainer.view_id]: currentContainer,
      [relatedGrid.view_id]: relatedGrid,
      [relatedContainer.view_id]: relatedContainer,
    };
    const loadViewMeta = jest.fn(async (viewId: string) => viewsById[viewId] ?? null);

    (getViews as jest.MockedFunction<typeof getViews>).mockRejectedValue(new Error('Batch endpoint unavailable'));
    (useDatabaseContext as jest.Mock).mockReturnValue({
      workspaceId: 'workspace-1',
      databaseDoc: { guid: 'current-database' },
      databasePageId: currentGrid.view_id,
      loadDatabaseRelations: jest.fn().mockResolvedValue({
        'current-database': currentGrid.view_id,
        'related-database': relatedGrid.view_id,
      }),
      loadViewMeta,
    });

    render(
      <RelationCreationDialog
        open
        initialFieldName='Relation'
        onOpenChange={jest.fn()}
        onCreate={jest.fn()}
      />
    );

    expect((await screen.findByTestId('relation-candidate-current-database')).textContent).toContain('To-dos');
    expect(screen.getByTestId('relation-candidate-related-database').textContent).toContain('Product roadmap');
    expect(loadViewMeta).toHaveBeenCalledTimes(4);
  });
});
