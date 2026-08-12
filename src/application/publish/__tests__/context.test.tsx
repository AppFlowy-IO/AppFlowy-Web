import { render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';

import { getRowKey } from '@/application/database-yjs/row_meta';
import { normalizePublishedPageSnapshot } from '@/application/publish-snapshot/normalize';
import { getPublishedDatabaseRenderRowMap } from '@/application/publish-snapshot/database-yjs-render-bridge';
import {
  publishedDatabasePayload,
  publishedDocumentPayload,
  publishedRowDocumentId,
} from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';
import { PublishContextType, PublishProvider, usePublishContext } from '@/application/publish';
import { RowService } from '@/application/services/domains';
import { ViewLayout, YjsEditorKey } from '@/application/types';
import { yDocToSlateContent } from '@/application/slate-yjs/utils/convert';

const mockNavigate = jest.fn();
const mockGetPage = jest.fn();
const mockGetView = jest.fn();
const mockGetViewInfo = jest.fn();
const mockGetViewMeta = jest.fn();
const mockGetRowDocument = jest.fn();
const mockGetOutline = jest.fn();

jest.mock('dexie-react-hooks', () => ({
  useLiveQuery: jest.fn(() => undefined),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('@/application/db', () => {
  const hookSubscribers: Record<string, Set<(...args: unknown[]) => unknown>> = {};
  const hook = jest.fn((eventName: string, subscriber?: (...args: unknown[]) => unknown) => {
    hookSubscribers[eventName] = hookSubscribers[eventName] ?? new Set();

    if (subscriber) {
      hookSubscribers[eventName].add(subscriber);
      return;
    }

    return {
      unsubscribe: (fn: (...args: unknown[]) => unknown) => {
        hookSubscribers[eventName]?.delete(fn);
      },
    };
  });

  return {
    db: {
      view_metas: {
        get: jest.fn(),
        hook,
      },
    },
  };
});

jest.mock('@/application/publish-snapshot/data-source', () => ({
  createPublishSnapshotDataSource: jest.fn(() => ({
    getPage: (...args: unknown[]) => mockGetPage(...args),
  })),
}));

jest.mock('@/application/services/domains', () => ({
  PublishService: {
    getOutline: (...args: unknown[]) => mockGetOutline(...args),
    getView: (...args: unknown[]) => mockGetView(...args),
    getViewInfo: (...args: unknown[]) => mockGetViewInfo(...args),
    getViewMeta: (...args: unknown[]) => mockGetViewMeta(...args),
    getRowDocument: (...args: unknown[]) => mockGetRowDocument(...args),
  },
  RowService: {
    create: jest.fn(),
    remove: jest.fn(),
  },
}));

function ContextProbe({ onContext }: { onContext: (context: PublishContextType) => void }) {
  const context = usePublishContext();

  useEffect(() => {
    if (context) {
      onContext(context);
    }
  }, [context, onContext]);

  return (
    <>
      <div data-testid="view-id">{context?.viewMeta?.view_id}</div>
      <div data-testid="breadcrumbs">{context?.breadcrumbs.map((crumb) => crumb.name).join('/')}</div>
    </>
  );
}

describe('PublishProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOutline.mockResolvedValue([]);
    mockGetViewInfo.mockResolvedValue({
      namespace: 'published-namespace',
      publishName: 'published-document',
      commentEnabled: true,
      duplicateEnabled: true,
    });
  });

  it('uses the published JSON snapshot as the publish metadata source', async () => {
    const snapshot = normalizePublishedPageSnapshot(publishedDocumentPayload);
    let latestContext: PublishContextType | undefined;

    render(
      <PublishProvider
        namespace={snapshot.namespace}
        publishName={snapshot.publishName}
        snapshot={snapshot}
      >
        <ContextProbe onContext={(context) => {
          latestContext = context;
        }} />
      </PublishProvider>
    );

    expect(screen.getByTestId('view-id').textContent).toBe(snapshot.view.viewId);
    await waitFor(() => {
      expect(screen.getByTestId('breadcrumbs').textContent).toBe(snapshot.view.name);
    });
    await waitFor(() => {
      expect(latestContext?.duplicateEnabled).toBe(true);
    });

    await expect(latestContext?.getViewIdFromDatabaseId?.('related-database-id')).resolves.toBe(
      'related-database-view-id'
    );
    expect(mockGetViewInfo).toHaveBeenCalledWith(snapshot.view.viewId);
    expect(mockGetViewMeta).not.toHaveBeenCalled();
  });

  it('loads related published pages through the JSON snapshot data source', async () => {
    const currentSnapshot = normalizePublishedPageSnapshot(publishedDocumentPayload);
    const relatedSnapshot = normalizePublishedPageSnapshot(publishedDatabasePayload);
    let latestContext: PublishContextType | undefined;

    if (relatedSnapshot.kind !== 'database') {
      throw new Error('Expected database snapshot fixture');
    }

    mockGetViewInfo.mockImplementation(async (viewId: string) => {
      if (viewId === relatedSnapshot.view.viewId) {
        return {
          namespace: relatedSnapshot.namespace,
          publishName: relatedSnapshot.publishName,
          commentEnabled: true,
          duplicateEnabled: true,
        };
      }

      return {
        namespace: currentSnapshot.namespace,
        publishName: currentSnapshot.publishName,
        commentEnabled: true,
        duplicateEnabled: true,
      };
    });
    mockGetPage.mockResolvedValue(relatedSnapshot);

    render(
      <PublishProvider
        namespace={currentSnapshot.namespace}
        publishName={currentSnapshot.publishName}
        snapshot={currentSnapshot}
      >
        <ContextProbe onContext={(context) => {
          latestContext = context;
        }} />
      </PublishProvider>
    );

    await waitFor(() => {
      expect(latestContext).toBeDefined();
    });

    const doc = await latestContext?.loadView(relatedSnapshot.view.viewId);
    const database = doc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
    const publishedRows = getPublishedDatabaseRenderRowMap(doc) ?? {};
    const publishedRow = await latestContext?.createRow?.(
      getRowKey(relatedSnapshot.database.databaseId, 'published-row-id')
    );

    expect(mockGetPage).toHaveBeenCalledWith(relatedSnapshot.namespace, relatedSnapshot.publishName);
    expect(mockGetView).not.toHaveBeenCalled();
    expect(doc?.guid).toBe(relatedSnapshot.database.databaseId);
    expect(database).toBeDefined();
    expect(Object.keys(publishedRows)).toEqual(['published-row-id']);
    expect(publishedRow).toBe(publishedRows['published-row-id']);
    expect(RowService.create).not.toHaveBeenCalled();
  });

  it('loads published row documents from the related database JSON snapshot', async () => {
    const currentSnapshot = normalizePublishedPageSnapshot(publishedDocumentPayload);
    const relatedSnapshot = normalizePublishedPageSnapshot(publishedDatabasePayload);
    let latestContext: PublishContextType | undefined;

    if (relatedSnapshot.kind !== 'database') {
      throw new Error('Expected database snapshot fixture');
    }

    mockGetViewInfo.mockResolvedValue({
      namespace: relatedSnapshot.namespace,
      publishName: relatedSnapshot.publishName,
      commentEnabled: true,
      duplicateEnabled: true,
    });
    mockGetPage.mockResolvedValue(relatedSnapshot);

    render(
      <PublishProvider
        namespace={currentSnapshot.namespace}
        publishName={currentSnapshot.publishName}
        snapshot={currentSnapshot}
      >
        <ContextProbe onContext={(context) => {
          latestContext = context;
        }} />
      </PublishProvider>
    );

    await waitFor(() => {
      expect(latestContext).toBeDefined();
    });

    await latestContext?.loadView(relatedSnapshot.view.viewId);

    const rowDocument = await latestContext?.loadRowDocument?.(publishedRowDocumentId);
    const rowDocumentContent = rowDocument ? yDocToSlateContent(rowDocument) : undefined;
    const firstRowDocumentBlock = rowDocumentContent?.children[0] as {
      children?: Array<{ children?: Array<{ text?: string }> }>;
    } | undefined;

    expect(firstRowDocumentBlock?.children?.[0]?.children?.[0]?.text).toBe('Published row document body');
    expect(mockGetRowDocument).not.toHaveBeenCalled();
  });

  it('opens a database child through its published container route', async () => {
    const currentSnapshot = normalizePublishedPageSnapshot(publishedDocumentPayload);
    const databaseChildId = 'in-progress-view-id';
    const databaseContainerId = 'projects-container-id';
    let latestContext: PublishContextType | undefined;

    mockGetOutline.mockResolvedValue([
      {
        view_id: databaseContainerId,
        name: 'projects',
        layout: ViewLayout.Grid,
        children: [
          {
            view_id: databaseChildId,
            parent_view_id: databaseContainerId,
            name: 'In Progress',
            layout: ViewLayout.Grid,
            children: [],
            icon: null,
            extra: { database_id: 'projects-database-id' },
            is_published: true,
            is_private: false,
          },
        ],
        icon: null,
        extra: { database_id: 'projects-database-id', is_database_container: true },
        is_published: true,
        is_private: false,
      },
    ]);
    mockGetViewInfo.mockImplementation(async (viewId: string) => {
      if (viewId === databaseContainerId) {
        return {
          namespace: 'published-namespace',
          publishName: 'projects',
          commentEnabled: true,
          duplicateEnabled: true,
        };
      }

      return {
        namespace: currentSnapshot.namespace,
        publishName: currentSnapshot.publishName,
        commentEnabled: true,
        duplicateEnabled: true,
      };
    });

    render(
      <PublishProvider
        namespace={currentSnapshot.namespace}
        publishName={currentSnapshot.publishName}
        snapshot={currentSnapshot}
      >
        <ContextProbe onContext={(context) => {
          latestContext = context;
        }} />
      </PublishProvider>
    );

    await waitFor(() => {
      expect(latestContext?.outline).toHaveLength(1);
    });

    await latestContext?.toView(databaseChildId);

    expect(mockGetViewInfo).toHaveBeenCalledWith(databaseContainerId);
    expect(mockGetViewInfo).not.toHaveBeenCalledWith(databaseChildId);
    expect(mockNavigate).toHaveBeenCalledWith('/published-namespace/projects?v=in-progress-view-id', {
      replace: true,
    });
  });

  it('opens an unpublished database container through its published child route', async () => {
    const currentSnapshot = normalizePublishedPageSnapshot(publishedDatabasePayload);
    const databaseContainerId = 'epics-container-id';
    const publishedChildId = 'by-status-view-id';
    const targetChildId = 'board-view-id';
    let latestContext: PublishContextType | undefined;

    mockGetOutline.mockResolvedValue([
      {
        view_id: databaseContainerId,
        name: '03_epics',
        layout: ViewLayout.Grid,
        children: [
          {
            view_id: publishedChildId,
            name: 'By Status',
            layout: ViewLayout.Grid,
            children: [],
            icon: null,
            extra: { database_id: 'epics-database-id' },
            is_published: true,
            is_private: false,
          },
          {
            view_id: targetChildId,
            name: 'Board',
            layout: ViewLayout.Board,
            children: [],
            icon: null,
            extra: { database_id: 'epics-database-id' },
            is_published: false,
            is_private: false,
          },
        ],
        icon: null,
        extra: { database_id: 'epics-database-id', is_database_container: true },
        is_published: false,
        is_private: false,
      },
    ]);
    mockGetViewInfo.mockImplementation(async (viewId: string) => {
      if (viewId === databaseContainerId) {
        throw new Error('View has not been published yet');
      }

      if (viewId === publishedChildId) {
        return {
          namespace: 'published-namespace',
          publishName: 'by-status',
          commentEnabled: true,
          duplicateEnabled: true,
        };
      }

      return {
        namespace: currentSnapshot.namespace,
        publishName: currentSnapshot.publishName,
        commentEnabled: true,
        duplicateEnabled: true,
      };
    });

    render(
      <PublishProvider
        namespace={currentSnapshot.namespace}
        publishName={currentSnapshot.publishName}
        snapshot={currentSnapshot}
      >
        <ContextProbe onContext={(context) => {
          latestContext = context;
        }} />
      </PublishProvider>
    );

    await waitFor(() => {
      expect(latestContext?.outline).toHaveLength(1);
    });

    await latestContext?.toView(targetChildId);

    expect(mockGetViewInfo).toHaveBeenCalledWith(publishedChildId);
    expect(mockGetViewInfo).not.toHaveBeenCalledWith(databaseContainerId);
    expect(mockGetViewInfo).not.toHaveBeenCalledWith(targetChildId);
    expect(mockNavigate).toHaveBeenCalledWith('/published-namespace/by-status?v=board-view-id', {
      replace: true,
    });
  });
});
