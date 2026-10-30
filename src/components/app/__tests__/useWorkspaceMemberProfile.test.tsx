import 'fake-indexeddb/auto';
import { deserialize, serialize } from 'node:v8';

import { afterAll, beforeAll, beforeEach, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';

import { db } from '@/application/db';
import { getWorkspaceMemberProfile } from '@/application/services/js-services/http/user-api';

import { useCurrentUserWorkspaceAvatar } from '../useWorkspaceMemberProfile';

jest.mock('@/application/db', () => {
  const Dexie = jest.requireActual<typeof import('dexie')>('dexie').Dexie;
  const database = new Dexie('workspace-avatar-refresh-test');

  database.version(1).stores({ workspace_member_profiles: '[workspace_id+user_uuid], workspace_id, user_uuid' });
  return { db: database };
});
jest.mock('@/application/services/js-services/http/user-api', () => ({ getWorkspaceMemberProfile: jest.fn() }));
jest.mock('@/components/app/app.hooks', () => ({ useCurrentWorkspaceIdOptional: () => mockWorkspaceId }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => ({ uuid: mockUserUuid }) }));

let mockWorkspaceId = 'workspace';
let mockUserUuid = 'user';
const getProfile = jest.mocked(getWorkspaceMemberProfile);
const remoteProfile: Awaited<ReturnType<typeof getWorkspaceMemberProfile>> = {
  uid: '1',
  avatar_url: '🎨',
  cover_image_url: null,
  custom_image_url: null,
  description: null,
  email: 'avatar-test@example.com',
  name: 'Updated member',
  role: 1,
  person_id: 'user',
  invited: false,
  last_mentioned_at: null,
};

beforeAll(() => {
  if (!globalThis.structuredClone) globalThis.structuredClone = (value: unknown) => deserialize(serialize(value));
});
beforeEach(async () => {
  mockWorkspaceId = 'workspace';
  mockUserUuid = 'user';
  getProfile.mockReset();
  await db.workspace_member_profiles.clear();
});
afterAll(() => db.close());

it('shows the cached avatar while refreshing a profile changed without a notification', async () => {
  await db.workspace_member_profiles.put({
    ...remoteProfile,
    workspace_id: 'workspace',
    user_uuid: 'user',
    avatar_url: '🙂',
    updated_at: 1,
  });
  let release!: (profile: typeof remoteProfile) => void;

  getProfile.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const { result } = renderHook(useCurrentUserWorkspaceAvatar);

  await waitFor(() => expect(result.current).toBe('🙂'));
  await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(1));
  await act(async () => {
    release(remoteProfile);
  });
  await waitFor(() => expect(result.current).toBe('🎨'));
  expect(getProfile).toHaveBeenCalledWith('workspace');
});

it('retains the cached avatar when the profile refresh is temporarily offline', async () => {
  await db.workspace_member_profiles.put({
    ...remoteProfile,
    workspace_id: 'workspace',
    user_uuid: 'user',
    avatar_url: '🙂',
    updated_at: 1,
  });
  getProfile.mockRejectedValueOnce(new Error('offline'));
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  try {
    const { result } = renderHook(useCurrentUserWorkspaceAvatar);

    await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current).toBe('🙂'));
  } finally {
    consoleError.mockRestore();
  }
});

it('hydrates a profile when the workspace has no cached member', async () => {
  getProfile.mockResolvedValueOnce(remoteProfile);
  const { result } = renderHook(useCurrentUserWorkspaceAvatar);

  await waitFor(() => expect(result.current).toBe('🎨'));
  expect(getProfile).toHaveBeenCalledTimes(1);
});

it('keeps a newer notification when an older refresh response arrives later', async () => {
  await db.workspace_member_profiles.put({
    ...remoteProfile,
    workspace_id: 'workspace',
    user_uuid: 'user',
    avatar_url: '🙂',
    updated_at: 1,
  });
  let release!: (profile: typeof remoteProfile) => void;

  getProfile.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const { result } = renderHook(useCurrentUserWorkspaceAvatar);

  await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(1));
  await act(async () => {
    await db.workspace_member_profiles.put({
      ...remoteProfile,
      workspace_id: 'workspace',
      user_uuid: 'user',
      avatar_url: '🌟',
      updated_at: 2,
    });
  });
  await waitFor(() => expect(result.current).toBe('🌟'));
  await act(async () => {
    release(remoteProfile);
  });
  expect((await db.workspace_member_profiles.get(['workspace', 'user']))?.avatar_url).toBe('🌟');
  expect(result.current).toBe('🌟');
});

it('does not publish a refresh after its last consumer unmounts', async () => {
  await db.workspace_member_profiles.put({
    ...remoteProfile,
    workspace_id: 'workspace',
    user_uuid: 'user',
    avatar_url: '🙂',
    updated_at: 1,
  });
  let release!: (profile: typeof remoteProfile) => void;

  getProfile.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const { unmount } = renderHook(useCurrentUserWorkspaceAvatar);

  await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () => {
    release(remoteProfile);
  });
  expect((await db.workspace_member_profiles.get(['workspace', 'user']))?.avatar_url).toBe('🙂');
});

it('shares one refresh and still publishes when its first consumer unmounts', async () => {
  let release!: (profile: typeof remoteProfile) => void;

  getProfile.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const first = renderHook(useCurrentUserWorkspaceAvatar);
  const second = renderHook(useCurrentUserWorkspaceAvatar);

  await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(1));
  first.unmount();
  await act(async () => {
    release(remoteProfile);
  });
  await waitFor(() => expect(second.result.current).toBe('🎨'));
  expect(getProfile).toHaveBeenCalledTimes(1);
});

it('keeps pending and cached profiles scoped while switching workspace and account', async () => {
  await db.workspace_member_profiles.put({
    ...remoteProfile,
    workspace_id: 'workspace',
    user_uuid: 'user',
    avatar_url: '🙂',
    updated_at: 1,
  });
  let release!: (profile: typeof remoteProfile) => void;

  getProfile.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  getProfile.mockResolvedValueOnce({ ...remoteProfile, avatar_url: '🚀' });
  const { result, rerender } = renderHook(useCurrentUserWorkspaceAvatar);

  await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(1));
  mockWorkspaceId = 'other-workspace';
  rerender();
  expect(result.current).toBeNull();
  await waitFor(() => expect(result.current).toBe('🚀'));
  await act(async () => {
    release(remoteProfile);
  });
  expect((await db.workspace_member_profiles.get(['workspace', 'user']))?.avatar_url).toBe('🙂');
  expect(result.current).toBe('🚀');

  getProfile.mockResolvedValueOnce({ ...remoteProfile, uid: '2', person_id: 'other-user', avatar_url: '🌿' });
  mockUserUuid = 'other-user';
  rerender();
  expect(result.current).toBeNull();
  await waitFor(() => expect(result.current).toBe('🌿'));
  expect((await db.workspace_member_profiles.get(['other-workspace', 'user']))?.avatar_url).toBe('🚀');
  expect((await db.workspace_member_profiles.get(['other-workspace', 'other-user']))?.avatar_url).toBe('🌿');
  expect(getProfile.mock.calls).toEqual([['workspace'], ['other-workspace'], ['other-workspace']]);
});

it('refreshes once while a scope has consumers and again after re-entry', async () => {
  getProfile.mockResolvedValue(remoteProfile);
  const first = renderHook(useCurrentUserWorkspaceAvatar);

  await waitFor(() => expect(first.result.current).toBe('🎨'));
  const second = renderHook(useCurrentUserWorkspaceAvatar);

  await waitFor(() => expect(second.result.current).toBe('🎨'));
  expect(getProfile).toHaveBeenCalledTimes(1);
  first.unmount();
  second.unmount();
  getProfile.mockResolvedValueOnce({ ...remoteProfile, avatar_url: '🚀' });
  const reopened = renderHook(useCurrentUserWorkspaceAvatar);

  await waitFor(() => expect(reopened.result.current).toBe('🚀'));
  expect(getProfile).toHaveBeenCalledTimes(2);
});
