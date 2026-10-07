import type { View } from '@/application/types';
import { ViewLayout } from '@/application/types';
import {
  createDatabaseBlockDeletionTracker,
  persistRecoveredDatabaseViewId,
  resolveDatabaseBlockDeletionTarget,
  resolveEmbeddedDatabaseViewId,
} from '@/components/editor/database-block-lifecycle';

function createView(viewId: string, overrides: Partial<View> = {}): View {
  return {
    children: [],
    extra: { is_space: false },
    icon: null,
    is_private: false,
    is_published: false,
    layout: ViewLayout.Document,
    name: viewId,
    view_id: viewId,
    ...overrides,
  };
}

describe('resolveDatabaseBlockDeletionTarget', () => {
  it('deletes the List view itself when it is linked directly under a document', async () => {
    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === 'list-view') return createView(viewId, { parent_view_id: 'document' });
      if (viewId === 'document') return createView(viewId);
      return null;
    });

    await expect(resolveDatabaseBlockDeletionTarget('list-view', loadViewMeta)).resolves.toBe('list-view');
  });

  it('deletes the owning container for an inline database child', async () => {
    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === 'list-view') return createView(viewId, { parent_view_id: 'database-container' });
      if (viewId === 'database-container') {
        return createView(viewId, {
          extra: { is_space: false, is_database_container: true },
          layout: ViewLayout.Grid,
        });
      }

      return null;
    });

    await expect(resolveDatabaseBlockDeletionTarget('list-view', loadViewMeta)).resolves.toBe('database-container');
  });

  it('falls back to the linked child when parent metadata is unavailable', async () => {
    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === 'list-view') return createView(viewId, { parent_view_id: 'document' });
      throw new Error('metadata unavailable');
    });

    await expect(resolveDatabaseBlockDeletionTarget('list-view', loadViewMeta)).resolves.toBe('list-view');
  });

  it('does nothing when the database view no longer exists', async () => {
    await expect(resolveDatabaseBlockDeletionTarget('missing-view', jest.fn().mockResolvedValue(null))).resolves.toBe(
      null
    );
  });
});

describe('database deletion history', () => {
  function setup() {
    const referenced = new Set<string>();
    const context = {
      readOnly: false,
      loadViewMeta: jest.fn(async (viewId: string) => createView(viewId, viewId === 'grid-view'
        ? { parent_view_id: 'database-container' }
        : { extra: { is_database_container: true }, layout: ViewLayout.Grid })),
      deletePage: jest.fn().mockResolvedValue(undefined),
      restorePage: jest.fn().mockResolvedValue(undefined),
    };
    const onError = jest.fn();
    const tracker = createDatabaseBlockDeletionTracker(() => context, (id) => referenced.has(id), onError);

    return { context, referenced, tracker, onError };
  }

  it('restores the owning database container when history reinserts its block', async () => {
    const { context, referenced, tracker } = setup();

    await tracker.reconcile('grid-view');
    expect(context.deletePage).toHaveBeenCalledWith('database-container');
    referenced.add('grid-view');
    await tracker.reconcile('grid-view');
    expect(context.restorePage).toHaveBeenCalledWith('database-container');

    referenced.clear();
    await tracker.reconcile('grid-view');
    expect(context.deletePage).toHaveBeenCalledTimes(2);
  });

  it('does not restore existing references that this editor never deleted', async () => {
    const { context, referenced, tracker } = setup();

    referenced.add('grid-view');
    await tracker.reconcile('grid-view');
    expect(context.loadViewMeta).not.toHaveBeenCalled();
    expect(context.deletePage).not.toHaveBeenCalled();
    expect(context.restorePage).not.toHaveBeenCalled();
  });

  it('cancels deletion when history restores the block while metadata is loading', async () => {
    const { context, referenced, tracker } = setup();
    let finishMetadata!: (view: View) => void;

    context.loadViewMeta.mockImplementationOnce(() => new Promise((resolve) => { finishMetadata = resolve; }));
    const deletion = tracker.reconcile('grid-view');

    await Promise.resolve();
    referenced.add('grid-view');
    finishMetadata(createView('grid-view'));
    await deletion;
    expect(context.deletePage).not.toHaveBeenCalled();
  });

  it('waits for an in-flight deletion before restoring a reinserted block', async () => {
    const { context, referenced, tracker } = setup();
    let finishDeletion!: () => void;

    context.deletePage.mockImplementationOnce(() => new Promise<void>((resolve) => { finishDeletion = resolve; }));
    const deletion = tracker.reconcile('grid-view');

    // Resolve both child and parent metadata before the deletion starts.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(context.deletePage).toHaveBeenCalledTimes(1);
    referenced.add('grid-view');
    tracker.restoreReferencedViews(referenced);
    expect(context.restorePage).not.toHaveBeenCalled();
    finishDeletion();
    await deletion;
    await tracker.reconcile('grid-view');
    expect(context.restorePage).toHaveBeenCalledTimes(1);
    expect(context.restorePage).toHaveBeenCalledWith('database-container');
  });

  it('does not treat a failed deletion as a database that must be restored', async () => {
    const { context, referenced, tracker, onError } = setup();
    const error = new Error('Deletion failed');

    context.deletePage.mockRejectedValueOnce(error);
    await tracker.reconcile('grid-view');
    expect(onError).toHaveBeenCalledWith('grid-view', error);
    referenced.add('grid-view');
    await tracker.reconcile('grid-view');
    expect(context.restorePage).not.toHaveBeenCalled();
  });

  it('gates deletion and restoration when the editor becomes read-only', async () => {
    const { context, referenced, tracker } = setup();

    context.readOnly = true;
    await tracker.reconcile('grid-view');
    expect(context.deletePage).not.toHaveBeenCalled();
    context.readOnly = false;
    await tracker.reconcile('grid-view');
    context.readOnly = true;
    referenced.add('grid-view');
    await tracker.reconcile('grid-view');
    expect(context.restorePage).not.toHaveBeenCalled();
  });

  it('does not delete a database when its owner becomes inactive during metadata loading', async () => {
    const { context, tracker } = setup();
    let finishMetadata!: (view: View) => void;

    context.loadViewMeta.mockImplementationOnce(() => new Promise((resolve) => { finishMetadata = resolve; }));
    const deletion = tracker.reconcile('grid-view');

    await Promise.resolve();
    context.readOnly = true;
    finishMetadata(createView('grid-view'));
    await deletion;
    expect(context.deletePage).not.toHaveBeenCalled();
  });
});

describe('resolveEmbeddedDatabaseViewId', () => {
  it('recovers the unique linked view under the document without using the original database view', async () => {
    const linkedView = createView('linked-view', {
      extra: { database_id: 'database-id', embedded: true, is_space: false },
      layout: ViewLayout.Grid,
      parent_view_id: 'document',
    });
    const loadViewMeta = jest.fn().mockResolvedValue(
      createView('document', {
        children: [
          createView('unrelated-view', {
            extra: { database_id: 'other-database', is_space: false },
            layout: ViewLayout.Grid,
            parent_view_id: 'document',
          }),
          linkedView,
          createView('database-container', {
            extra: { database_id: 'database-id', is_database_container: true, is_space: false },
            layout: ViewLayout.Grid,
            parent_view_id: 'document',
          }),
        ],
      })
    );

    await expect(resolveEmbeddedDatabaseViewId('document', 'database-id', loadViewMeta)).resolves.toBe('linked-view');
    expect(loadViewMeta).toHaveBeenCalledWith('document', undefined, {
      authoritative: true,
      metadataOnly: false,
    });
  });

  it('recovers the documented childless web linked-view shape despite its container marker', async () => {
    const loadViewMeta = jest.fn().mockResolvedValue(
      createView('document', {
        children: [
          createView('linked-view', {
            extra: {
              database_id: 'database-id',
              embedded: true,
              is_database_container: true,
              is_space: false,
            },
            layout: ViewLayout.Grid,
            parent_view_id: 'document',
          }),
          createView('lazy-container', {
            extra: {
              database_id: 'database-id',
              embedded: true,
              is_database_container: true,
              is_space: false,
            },
            has_children: true,
            layout: ViewLayout.Grid,
            parent_view_id: 'document',
          }),
        ],
      })
    );

    await expect(resolveEmbeddedDatabaseViewId('document', 'database-id', loadViewMeta)).resolves.toBe('linked-view');
  });

  it('does not guess when more than one linked view has the same parent and database', async () => {
    const loadViewMeta = jest.fn().mockResolvedValue(
      createView('document', {
        children: ['linked-a', 'linked-b'].map((viewId) =>
          createView(viewId, {
            extra: { database_id: 'database-id', embedded: true, is_space: false },
            layout: ViewLayout.Grid,
            parent_view_id: 'document',
          })
        ),
      })
    );

    await expect(resolveEmbeddedDatabaseViewId('document', 'database-id', loadViewMeta)).resolves.toBeNull();
  });

  it('uses the block layout to recover among views of the same database', async () => {
    const loadViewMeta = jest.fn().mockResolvedValue(
      createView('document', {
        children: [
          createView('grid-view', {
            extra: { database_id: 'database-id', embedded: true, is_space: false },
            layout: ViewLayout.Grid,
            parent_view_id: 'document',
          }),
          createView('board-view', {
            extra: { database_id: 'database-id', embedded: true, is_space: false },
            layout: ViewLayout.Board,
            parent_view_id: 'document',
          }),
        ],
      })
    );

    await expect(resolveEmbeddedDatabaseViewId('document', 'database-id', loadViewMeta, ViewLayout.Board)).resolves.toBe(
      'board-view'
    );
  });

  it('does not guess when the document has no matching linked view', async () => {
    const loadViewMeta = jest.fn().mockResolvedValue(createView('document'));

    await expect(resolveEmbeddedDatabaseViewId('document', 'database-id', loadViewMeta)).resolves.toBeNull();
  });
});

describe('persistRecoveredDatabaseViewId', () => {
  it('retries a transient Slate path failure and reports success only after the write succeeds', async () => {
    const persistViewIds = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const wait = jest.fn().mockResolvedValue(undefined);

    await expect(
      persistRecoveredDatabaseViewId('recovered-view', persistViewIds, {
        retryDelaysMs: [100],
        wait,
      })
    ).resolves.toBe(true);
    expect(persistViewIds).toHaveBeenNthCalledWith(1, ['recovered-view']);
    expect(persistViewIds).toHaveBeenNthCalledWith(2, ['recovered-view']);
    expect(wait).toHaveBeenCalledWith(100);
  });

  it('stops after the bounded retry schedule without reporting a failed write as complete', async () => {
    const persistViewIds = jest.fn().mockReturnValue(false);
    const wait = jest.fn().mockResolvedValue(undefined);

    await expect(
      persistRecoveredDatabaseViewId('recovered-view', persistViewIds, {
        retryDelaysMs: [100, 500],
        wait,
      })
    ).resolves.toBe(false);
    expect(persistViewIds).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[100], [500]]);
  });

  it('does not retry after the owning effect is cancelled', async () => {
    let cancelled = false;
    const persistViewIds = jest.fn(() => {
      cancelled = true;
      return false;
    });
    const wait = jest.fn().mockResolvedValue(undefined);

    await expect(
      persistRecoveredDatabaseViewId('recovered-view', persistViewIds, {
        isCancelled: () => cancelled,
        retryDelaysMs: [100],
        wait,
      })
    ).resolves.toBe(false);
    expect(persistViewIds).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(100);
  });
});
