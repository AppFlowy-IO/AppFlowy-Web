import { act, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseViewLayout, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import { DatabaseTabItem } from '@/components/database/components/tabs/DatabaseTabItem';
import { Tabs, TabsList } from '@/components/ui/tabs';

jest.mock('@/components/_shared/reorder/useReorderableItem', () => ({
  useReorderableItem: () => ({
    dragState: { type: 'idle' },
    shouldSuppressClick: () => false,
  }),
}));

jest.mock('@/components/_shared/view-icon/PageIcon', () => () => null);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const viewId = 'database-view-id';

describe('DatabaseTabItem', () => {
  it('rerenders when the mutable Yjs view name changes', () => {
    const doc = new Y.Doc();
    const view = doc.getMap('view') as YDatabaseView;

    view.set(YjsDatabaseKey.name, 'Grid');
    view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);

    render(
      <Tabs value={viewId}>
        <TabsList>
          <DatabaseTabItem
            viewId={viewId}
            view={view}
            databasePageId={viewId}
            menuViewId={null}
            readOnly={false}
            visibleViewIds={[viewId]}
            onSetMenuViewId={jest.fn()}
            onOpenDeleteModal={jest.fn()}
            onOpenRenameModal={jest.fn()}
            setTabRef={jest.fn()}
          />
        </TabsList>
      </Tabs>
    );

    expect(screen.getByTestId(`view-tab-${viewId}`).textContent).toContain('Grid');

    act(() => {
      view.set(YjsDatabaseKey.name, 'Synced Board');
    });

    expect(screen.getByTestId(`view-tab-${viewId}`).textContent).toContain('Synced Board');
  });
});
