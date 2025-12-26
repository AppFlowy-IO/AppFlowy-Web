import { expect } from '@jest/globals';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import { View, ViewLayout, ViewMetaProps, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import DatabaseView from '@/components/app/DatabaseView';

declare global {
  // eslint-disable-next-line no-var
  var __databaseViewTestState:
    | {
        outline?: View[];
        capturedDatabaseProps?: unknown;
        capturedViewMetaProps?: unknown;
      }
    | undefined;
}

jest.mock('@/components/app/app.hooks', () => ({
  useAppOutline: () => global.__databaseViewTestState?.outline,
}));

jest.mock('@/components/database', () => ({
  Database: (props: unknown) => {
    global.__databaseViewTestState = {
      ...(global.__databaseViewTestState || {}),
      capturedDatabaseProps: props,
    };
    return null;
  },
}));

jest.mock('src/components/view-meta/ViewMetaPreview', () => (props: unknown) => {
  global.__databaseViewTestState = {
    ...(global.__databaseViewTestState || {}),
    capturedViewMetaProps: props,
  };
  return null;
});

function createDatabaseDoc(databaseId: string): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();

  database.set(YjsDatabaseKey.id, databaseId);
  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

describe('DatabaseView database container', () => {
  beforeEach(() => {
    global.__databaseViewTestState = undefined;
  });

  it('uses container for page meta and container children for visibleViewIds', () => {
    const containerId = 'container-id';
    const gridViewId = 'grid-view-id';
    const boardViewId = 'board-view-id';

    const gridView: View = {
      view_id: gridViewId,
      name: 'Grid',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
      parent_view_id: containerId,
    };

    const boardView: View = {
      view_id: boardViewId,
      name: 'Board',
      icon: null,
      layout: ViewLayout.Board,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
      parent_view_id: containerId,
    };

    const containerView: View = {
      view_id: containerId,
      name: 'New Database',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false, is_database_container: true },
      children: [gridView, boardView],
      is_published: false,
      is_private: false,
    };

    global.__databaseViewTestState = { outline: [containerView] };

    const viewMeta: ViewMetaProps = {
      viewId: gridViewId,
      name: gridView.name,
      layout: gridView.layout,
      icon: gridView.icon || undefined,
      extra: gridView.extra,
      workspaceId: 'workspace-id',
      visibleViewIds: [],
    };

    render(
      <MemoryRouter initialEntries={['/app/workspace-id/grid-view-id']}>
        <DatabaseView
          doc={createDatabaseDoc('db-1')}
          workspaceId={'workspace-id'}
          readOnly={false}
          viewMeta={viewMeta}
          updatePage={jest.fn()}
          updatePageIcon={jest.fn()}
          updatePageName={jest.fn()}
          onRendered={jest.fn()}
        />
      </MemoryRouter>
    );

    const databaseProps = global.__databaseViewTestState?.capturedDatabaseProps as
      | { visibleViewIds: string[]; databaseName: string }
      | undefined;
    const metaProps = global.__databaseViewTestState?.capturedViewMetaProps as
      | { viewId?: string; name?: string }
      | undefined;

    expect(databaseProps).toBeDefined();
    expect(metaProps).toBeDefined();

    // Tab bar should only show container's child views (tabs).
    expect(databaseProps?.visibleViewIds).toEqual([gridViewId, boardViewId]);

    // Database should use the container's name (page-level naming).
    expect(databaseProps?.databaseName).toBe('New Database');

    // Page meta preview should target the container for rename/icon updates.
    expect(metaProps?.viewId).toBe(containerId);
    expect(metaProps?.name).toBe('New Database');
  });
});
