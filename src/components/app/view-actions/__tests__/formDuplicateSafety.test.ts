import { View, ViewLayout } from '@/application/types';

import {
  assertGenericDeepDuplicateIsSafe,
  FORM_DEEP_DUPLICATE_CHECK_FAILED_MESSAGE,
  FORM_DEEP_DUPLICATE_UNAVAILABLE_MESSAGE,
  isUnsafeFormDeepDuplicate,
} from '../formDuplicateSafety';

function createView(viewId: string, overrides: Partial<View> = {}): View {
  return {
    view_id: viewId,
    name: viewId,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

function createContainer(children: View[]): View {
  return createView('container-id', {
    layout: ViewLayout.Grid,
    extra: { is_database_container: true, is_space: false },
    children,
  });
}

describe('generic Form deep-duplicate safety', () => {
  it('identifies both a Form page and a database container with a Form child', () => {
    const form = createView('form-id', { layout: ViewLayout.Form });
    const document = createView('document-id', {
      children: [createView('nested-container', { children: [form] })],
    });

    expect(isUnsafeFormDeepDuplicate(form)).toBe(true);
    expect(isUnsafeFormDeepDuplicate(createContainer([form]))).toBe(true);
    expect(isUnsafeFormDeepDuplicate(document)).toBe(true);
    expect(isUnsafeFormDeepDuplicate(createContainer([createView('grid-id', { layout: ViewLayout.Grid })]))).toBe(false);
  });

  it('blocks a known Form before any generic duplicate preflight work', async () => {
    const loadFreshView = jest.fn();

    await expect(
      assertGenericDeepDuplicateIsSafe({
        workspaceId: 'workspace-id',
        viewId: 'form-id',
        knownView: createView('form-id', { layout: ViewLayout.Form }),
        loadFreshView,
      })
    ).rejects.toThrow(FORM_DEEP_DUPLICATE_UNAVAILABLE_MESSAGE);
    expect(loadFreshView).not.toHaveBeenCalled();
  });

  it('refreshes a container and catches a Form missing from stale outline children', async () => {
    const staleContainer = createContainer([createView('grid-id', { layout: ViewLayout.Grid })]);
    const freshContainer = createContainer([
      createView('grid-id', { layout: ViewLayout.Grid }),
      createView('form-id', { layout: ViewLayout.Form }),
    ]);
    const loadFreshView = jest.fn().mockResolvedValue(freshContainer);

    await expect(
      assertGenericDeepDuplicateIsSafe({
        workspaceId: 'workspace-id',
        viewId: staleContainer.view_id,
        knownView: staleContainer,
        loadFreshView,
      })
    ).rejects.toThrow(FORM_DEEP_DUPLICATE_UNAVAILABLE_MESSAGE);
    expect(loadFreshView).toHaveBeenCalledWith('workspace-id', staleContainer.view_id, 50);
  });

  it('refreshes a non-database page and catches a nested Form missing from stale outline metadata', async () => {
    const staleDocument = createView('document-id');
    const nestedForm = createView('form-id', { layout: ViewLayout.Form });
    const freshDocument = createView('document-id', {
      children: [createView('nested-container', { children: [nestedForm] })],
    });
    const loadFreshView = jest.fn().mockResolvedValue(freshDocument);

    await expect(
      assertGenericDeepDuplicateIsSafe({
        workspaceId: 'workspace-id',
        viewId: staleDocument.view_id,
        knownView: staleDocument,
        loadFreshView,
      })
    ).rejects.toThrow(FORM_DEEP_DUPLICATE_UNAVAILABLE_MESSAGE);
    expect(loadFreshView).toHaveBeenCalledWith('workspace-id', staleDocument.view_id, 50);
  });

  it('fails closed when database child metadata cannot be verified', async () => {
    await expect(
      assertGenericDeepDuplicateIsSafe({
        workspaceId: 'workspace-id',
        viewId: 'container-id',
        knownView: createContainer([createView('grid-id', { layout: ViewLayout.Grid })]),
        loadFreshView: jest.fn().mockRejectedValue(new Error('offline')),
      })
    ).rejects.toThrow(FORM_DEEP_DUPLICATE_CHECK_FAILED_MESSAGE);
  });
});
