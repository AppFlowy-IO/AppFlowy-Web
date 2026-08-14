import type { View } from '@/application/types';
import { ViewLayout } from '@/application/types';
import { resolveDatabaseBlockDeletionTarget } from '@/components/editor/database-block-lifecycle';

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
