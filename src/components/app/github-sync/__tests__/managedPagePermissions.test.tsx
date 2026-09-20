import { renderHook, waitFor } from '@testing-library/react';

import { AccessLevel, CollabObjectPermission, Types, View, ViewLayout } from '@/application/types';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';

let managed = true;
let loading = false;
let error = false;
let permission: CollabObjectPermission;

jest.mock('@/application/services/domains', () => ({ AccessService: {}, ViewService: {} }));
jest.mock('@/components/app/app.hooks', () => ({ useCurrentWorkspaceId: () => 'workspace' }));
jest.mock('@/components/app/hooks/useViewObjectPermission', () => ({ useViewObjectPermission: () => permission }));
jest.mock('../useGithubPageSource', () => ({
  useGithubPageSource: () => ({ managed, loading, readOnly: managed || loading || error }),
}));

const view = { view_id: 'view', layout: ViewLayout.Document } as View;

beforeEach(() => {
  managed = true;
  loading = false;
  error = false;
  permission = {
    object_id: 'view',
    governing_view_id: 'view',
    access_level: AccessLevel.FullAccess,
    collab_type: Types.Document,
    can_read: true,
    can_write: true,
    can_comment: true,
    can_share: true,
  } as CollabObjectPermission;
});

test('managed pages retain history preview but lose edit, add, move, rename and delete capabilities', async () => {
  const hook = renderHook(() => useViewActionPermissions(view, true));

  await waitFor(() => expect(hook.result.current.hasLoadedViewActionPermissions).toBe(true));
  expect(hook.result.current.canRead).toBe(true);
  expect(hook.result.current.canWrite).toBe(false);
  expect(hook.result.current.canCreateViewActions).toBe(false);
  expect(hook.result.current.canManageViewActions).toBe(false);
  expect(hook.result.current.canUsePageHistory).toBe(true);
});

test('managed history remains visible when canonical source write protection denies writes', async () => {
  permission.can_write = false;
  const hook = renderHook(() => useViewActionPermissions(view, true));

  await waitFor(() => expect(hook.result.current.canUsePageHistory).toBe(true));
  expect(hook.result.current.canManageViewActions).toBe(false);
});

test('ordinary pages keep their previous capabilities after the source probe completes', async () => {
  managed = false;
  const hook = renderHook(() => useViewActionPermissions(view, true));

  await waitFor(() => expect(hook.result.current.canManageViewActions).toBe(true));
  expect(hook.result.current.canWrite).toBe(true);
  expect(hook.result.current.canCreateViewActions).toBe(true);
  expect(hook.result.current.canUsePageHistory).toBe(true);
});

test('source probes do not briefly expose structural actions before ownership resolves', async () => {
  managed = false;
  loading = true;
  const hook = renderHook(() => useViewActionPermissions(view, true));

  await waitFor(() => expect(hook.result.current.hasLoadedViewActionPermissions).toBe(true));
  expect(hook.result.current.canManageViewActions).toBe(false);
  expect(hook.result.current.canCreateViewActions).toBe(false);
  expect(hook.result.current.canWrite).toBe(false);
});

test('an unavailable ownership check cannot enable mutations with cached write permissions', async () => {
  managed = false;
  error = true;
  const hook = renderHook(() => useViewActionPermissions(view, true));

  await waitFor(() => expect(hook.result.current.hasLoadedViewActionPermissions).toBe(true));
  expect(hook.result.current.canRead).toBe(true);
  expect(hook.result.current.canWrite).toBe(false);
  expect(hook.result.current.canManageViewActions).toBe(false);
  expect(hook.result.current.canCreateViewActions).toBe(false);
});
