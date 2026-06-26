import { expect } from '@jest/globals';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import { ViewLayout, ViewMetaProps, YDoc, YjsEditorKey } from '@/application/types';
import DatabaseView from '@/components/publish/DatabaseView';

declare global {
  // eslint-disable-next-line no-var
  var __publishDatabaseViewTestState:
    | {
        capturedDatabaseProps?: unknown;
      }
    | undefined;
}

jest.mock('@/application/publish', () => ({
  usePublishContext: () => ({ isTemplateThumb: false, outline: [] }),
}));

jest.mock('@/components/database', () => ({
  Database: (props: unknown) => {
    global.__publishDatabaseViewTestState = {
      ...(global.__publishDatabaseViewTestState || {}),
      capturedDatabaseProps: props,
    };
    return null;
  },
}));

jest.mock('src/components/view-meta/ViewMetaPreview', () => () => null);

function createDatabaseDoc(): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();

  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

describe('published DatabaseView database container', () => {
  beforeEach(() => {
    global.__publishDatabaseViewTestState = undefined;
  });

  it('uses the first visible database view when the published route is the container', () => {
    const viewMeta: ViewMetaProps = {
      viewId: 'container-id',
      name: 'Published Database',
      layout: ViewLayout.Grid,
      icon: undefined,
      extra: { is_database_container: true },
      workspaceId: 'workspace-id',
      visibleViewIds: ['grid-view-id', 'board-view-id'],
    };

    render(
      <MemoryRouter initialEntries={['/published/database']}>
        <DatabaseView doc={createDatabaseDoc()} workspaceId='workspace-id' viewMeta={viewMeta} />
      </MemoryRouter>
    );

    const databaseProps = global.__publishDatabaseViewTestState?.capturedDatabaseProps as
      | { databasePageId?: string; activeViewId?: string; visibleViewIds?: string[] }
      | undefined;

    expect(databaseProps?.databasePageId).toBe('container-id');
    expect(databaseProps?.activeViewId).toBe('grid-view-id');
    expect(databaseProps?.visibleViewIds).toEqual(['grid-view-id', 'board-view-id']);
  });
});
