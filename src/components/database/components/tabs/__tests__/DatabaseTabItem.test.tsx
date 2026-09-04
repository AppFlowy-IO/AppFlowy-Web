import { act, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseViewLayout, ViewLayout, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import { DatabaseTabItem } from '@/components/database/components/tabs/DatabaseTabItem';
import { Tabs, TabsList } from '@/components/ui/tabs';

jest.mock('@/components/_shared/reorder/useReorderableItem', () => ({
  useReorderableItem: () => ({
    dragState: { type: 'idle' },
    shouldSuppressClick: () => false,
  }),
}));

jest.mock('@/components/_shared/view-icon/PageIcon', () => ({ view }: { view: { layout: number } }) => (
  <span data-testid='database-tab-icon-layout'>{view.layout}</span>
));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const viewId = 'database-view-id';

describe('DatabaseTabItem', () => {
  it('uses the List name and icon for a List view', () => {
    const doc = new Y.Doc();
    const view = doc.getMap('view') as YDatabaseView;

    view.set(YjsDatabaseKey.name, '');
    view.set(YjsDatabaseKey.layout, DatabaseViewLayout.List);

    render(
      <Tabs value={viewId}>
        <TabsList>
          <DatabaseTabItem
            databasePageId={viewId}
            menuViewId={null}
            onOpenDeleteModal={jest.fn()}
            onOpenRenameModal={jest.fn()}
            onSetMenuViewId={jest.fn()}
            readOnly={false}
            setTabRef={jest.fn()}
            view={view}
            viewId={viewId}
            visibleViewIds={[viewId]}
          />
        </TabsList>
      </Tabs>
    );

    expect(screen.getByTestId(`view-tab-${viewId}`).textContent).toContain('List');
    expect(screen.getByTestId('database-tab-icon-layout').textContent).toBe(String(ViewLayout.List));
  });
  it('uses the Gallery name and icon for a Gallery view', () => {
    const doc = new Y.Doc();
    const view = doc.getMap('view') as YDatabaseView;

    view.set(YjsDatabaseKey.name, '');
    view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Gallery);

    render(
      <Tabs value={viewId}>
        <TabsList>
          <DatabaseTabItem
            databasePageId={viewId}
            menuViewId={null}
            onOpenDeleteModal={jest.fn()}
            onOpenRenameModal={jest.fn()}
            onSetMenuViewId={jest.fn()}
            readOnly={false}
            setTabRef={jest.fn()}
            view={view}
            viewId={viewId}
            visibleViewIds={[viewId]}
          />
        </TabsList>
      </Tabs>
    );

    expect(screen.getByTestId(`view-tab-${viewId}`).textContent).toContain('Gallery');
    expect(screen.getByTestId('database-tab-icon-layout').textContent).toBe(String(ViewLayout.Gallery));
  });

  it('uses the desktop Form builder name and Form icon for an unnamed Form view', () => {
    const doc = new Y.Doc();
    const view = doc.getMap('view') as YDatabaseView;

    view.set(YjsDatabaseKey.name, '');
    view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Form);

    render(
      <Tabs value={viewId}>
        <TabsList>
          <DatabaseTabItem
            databasePageId={viewId}
            menuViewId={null}
            onOpenDeleteModal={jest.fn()}
            onOpenRenameModal={jest.fn()}
            onSetMenuViewId={jest.fn()}
            readOnly={false}
            setTabRef={jest.fn()}
            view={view}
            viewId={viewId}
            visibleViewIds={[viewId]}
          />
        </TabsList>
      </Tabs>
    );

    expect(screen.getByTestId(`view-tab-${viewId}`).textContent).toContain('Form builder');
    expect(screen.getByTestId('database-tab-icon-layout').textContent).toBe(String(ViewLayout.Form));
  });

  it('renders a new database tab whose Yjs layout is BigInt', () => {
    const view = {
      get: jest.fn((key: YjsDatabaseKey) => (key === YjsDatabaseKey.name ? 'Grid' : BigInt(DatabaseViewLayout.Grid))),
      observe: jest.fn(),
      unobserve: jest.fn(),
    } as unknown as YDatabaseView;

    expect(() =>
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
      )
    ).not.toThrow();

    expect(screen.getByTestId(`view-tab-${viewId}`).textContent).toContain('Grid');
  });

  it('prefers the folder/outline name over the collab layout-default name (desktop parity)', () => {
    // Desktop creates database views with the layout name ("Grid") in the
    // database collab and never updates it on rename — the folder view holds
    // the user-visible name ("kkk").
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
            nameOverride='kkk'
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

    expect(screen.getByTestId(`view-tab-${viewId}`).textContent).toContain('kkk');
  });

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
