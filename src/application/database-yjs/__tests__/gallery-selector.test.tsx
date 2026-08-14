import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  type DatabaseContextState,
  useDatabaseGroupFieldIdSelector,
  useGalleryLayoutSettings,
} from '@/application/database-yjs';
import {
  GalleryCardPreview,
  GalleryCardSize,
  type YDatabase,
  type YDatabaseView,
  type YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

function createFixture({ includeGroup = true }: { includeGroup?: boolean } = {}) {
  const databaseDoc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const layoutSettings = new Y.Map();
  const gallerySettings = new Y.Map();
  const groups = new Y.Array<Y.Map<unknown>>();
  const group = new Y.Map();

  gallerySettings.set(YjsDatabaseKey.show_cover, false);
  gallerySettings.set(YjsDatabaseKey.fit_image, true);
  gallerySettings.set(YjsDatabaseKey.card_size, GalleryCardSize.Large);
  gallerySettings.set(YjsDatabaseKey.card_preview, GalleryCardPreview.PageContent);
  layoutSettings.set('5', gallerySettings);
  group.set(YjsDatabaseKey.field_id, 'status');
  if (includeGroup) groups.push([group]);
  view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  view.set(YjsDatabaseKey.groups, groups);
  views.set('gallery-view', view);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const context: DatabaseContextState = {
    activeViewId: 'gallery-view',
    databaseDoc,
    databasePageId: 'gallery-view',
    readOnly: false,
    rowMap: null,
    workspaceId: 'workspace',
  };

  return { context, gallerySettings, group };
}

describe('Gallery selectors', () => {
  it('reads Gallery geometry synchronously and normalizes stale cover-off state', () => {
    const { context, gallerySettings } = createFixture();
    const { result } = renderHook(() => useGalleryLayoutSettings(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>,
    });

    expect(result.current).toMatchObject({
      cardPreview: GalleryCardPreview.PageContent,
      cardSize: GalleryCardSize.Large,
      fitImage: true,
      showCover: true,
    });

    act(() => {
      gallerySettings.set(YjsDatabaseKey.card_size, GalleryCardSize.Small);
    });
    expect(result.current.cardSize).toBe(GalleryCardSize.Small);
  });

  it('tracks the preserved group field used to suppress Gallery properties', () => {
    const { context, group } = createFixture();
    const { result } = renderHook(() => useDatabaseGroupFieldIdSelector(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>,
    });

    expect(result.current).toBe('status');

    act(() => {
      group.set(YjsDatabaseKey.field_id, 'owner');
    });
    expect(result.current).toBe('owner');
  });

  it('returns no group field for a normal ungrouped Gallery view', () => {
    const { context } = createFixture({ includeGroup: false });
    const { result } = renderHook(() => useDatabaseGroupFieldIdSelector(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>,
    });

    expect(result.current).toBeUndefined();
  });
});
