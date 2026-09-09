import { fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseViewLayout, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import { DatabaseViewTabs } from '@/components/database/components/tabs/DatabaseViewTabs';

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

class ResizeObserverMock {
  observe = jest.fn();

  unobserve = jest.fn();

  disconnect = jest.fn();
}

function createViews(
  definitions: Array<{ viewId: string; name: string; layout: DatabaseViewLayout }>
): { doc: Y.Doc; views: Y.Map<YDatabaseView> } {
  const doc = new Y.Doc();
  const views = doc.getMap<YDatabaseView>('views');

  for (const { viewId, name, layout } of definitions) {
    const view = new Y.Map() as YDatabaseView;

    view.set(YjsDatabaseKey.id, viewId);
    view.set(YjsDatabaseKey.name, name);
    view.set(YjsDatabaseKey.layout, layout);
    views.set(viewId, view);
  }

  return { doc, views };
}

function renderTabs(viewIds: string[], views: Y.Map<YDatabaseView>, setSelectedViewId = jest.fn()) {
  return {
    setSelectedViewId,
    ...render(
      <DatabaseViewTabs
        databasePageId={viewIds[0]}
        menuViewId={null}
        readOnly
        selectedViewId={viewIds[0]}
        setDeleteConfirmOpen={jest.fn()}
        setMenuViewId={jest.fn()}
        setRenameView={jest.fn()}
        setSelectedViewId={setSelectedViewId}
        viewIds={viewIds}
        views={views}
        visibleViewIds={viewIds}
      />
    ),
  };
}

describe('DatabaseViewTabs Form responses', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('renders the real Form and Responses views in container order', () => {
    const formId = 'form-view-id';
    const responsesId = 'responses-view-id';
    const { doc, views } = createViews([
      { viewId: formId, name: 'Form', layout: DatabaseViewLayout.Form },
      { viewId: responsesId, name: 'Responses', layout: DatabaseViewLayout.Grid },
    ]);
    const { setSelectedViewId } = renderTabs([formId, responsesId], views);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Form', 'Responses']);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Responses' }), { button: 0, ctrlKey: false });

    expect(setSelectedViewId).toHaveBeenCalledWith(responsesId);
    doc.destroy();
  });

  it('continues to render a legacy database that only contains a Form view', () => {
    const formId = 'legacy-form-view-id';
    const { doc, views } = createViews([
      { viewId: formId, name: 'Form', layout: DatabaseViewLayout.Form },
    ]);

    renderTabs([formId], views);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Form']);
    doc.destroy();
  });
});
