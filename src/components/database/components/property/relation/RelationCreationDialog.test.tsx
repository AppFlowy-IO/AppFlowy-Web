import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import { View, ViewLayout } from '@/application/types';
import { RelationCreationDialog } from '@/components/database/components/property/relation/RelationCreationDialog';

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: jest.fn(),
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

    (useDatabaseContext as jest.Mock).mockReturnValue({
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

    expect(loadViewMeta).toHaveBeenCalledWith(currentContainer.view_id);
    expect(loadViewMeta).toHaveBeenCalledWith(relatedContainer.view_id);
  });
});
