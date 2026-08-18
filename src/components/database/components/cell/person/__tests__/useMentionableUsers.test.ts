import { act, renderHook, waitFor } from '@testing-library/react';

import { db } from '@/application/db';
import { WorkspaceService } from '@/application/services/domains';
import { MentionablePerson, MentionPersonRole } from '@/application/types';
import { useCurrentWorkspaceIdOptional } from '@/components/app/app.hooks';
import {
  getMentionableUserIndex,
  useMentionableUsersWithAutoFetch,
} from '@/components/database/components/cell/person/useMentionableUsers';

jest.mock('@/application/db', () => ({
  db: {
    workspace_member_profiles: {
      bulkPut: jest.fn(),
      where: jest.fn(),
    },
  },
}));

jest.mock('@/application/services/domains', () => ({
  WorkspaceService: {
    getMentionableUsers: jest.fn(),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceIdOptional: jest.fn(),
}));

const mockWorkspaceService = WorkspaceService as jest.Mocked<typeof WorkspaceService>;
const mockUseCurrentWorkspaceIdOptional = useCurrentWorkspaceIdOptional as jest.MockedFunction<
  typeof useCurrentWorkspaceIdOptional
>;
const mockProfiles = db.workspace_member_profiles as unknown as {
  bulkPut: jest.Mock;
  where: jest.Mock;
};

function person(uid: string | number, name: string): MentionablePerson {
  return {
    uid,
    avatar_url: null,
    cover_image_url: null,
    custom_image_url: null,
    description: null,
    email: `${name.toLowerCase()}@example.com`,
    name,
    role: MentionPersonRole.Member,
    person_id: name.toLowerCase(),
    invited: false,
    last_mentioned_at: null,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('getMentionableUserIndex', () => {
  it('indexes exact UIDs once per shared member snapshot', () => {
    const users = [person('9007199254740993', 'Nathan'), person('9007199254740994', 'Eva')];
    const first = getMentionableUserIndex(users);
    const second = getMentionableUserIndex(users);

    expect(second).toBe(first);
    expect(first.get('9007199254740993')?.name).toBe('Nathan');
    expect(first.get('9007199254740994')?.name).toBe('Eva');
  });

  it('omits already-rounded unsafe numeric identifiers', () => {
    const unsafe = person(Number.MAX_SAFE_INTEGER + 1, 'Legacy');

    expect(getMentionableUserIndex([unsafe])).toEqual(new Map());
  });
});

describe('useMentionableUsersWithAutoFetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shares concurrent disk and API refreshes across consumers', async () => {
    const diskLoad = createDeferred<never[]>();
    const apiRefresh = createDeferred<MentionablePerson[]>();
    const toArray = jest.fn().mockReturnValue(diskLoad.promise);
    const deleteProfiles = jest.fn().mockResolvedValue(undefined);
    const equals = jest.fn(() => ({ delete: deleteProfiles, toArray }));
    const users = [person('9007199254740993', 'Nathan')];

    mockUseCurrentWorkspaceIdOptional.mockReturnValue('concurrent-workspace');
    mockProfiles.where.mockReturnValue({ equals });
    mockProfiles.bulkPut.mockResolvedValue(undefined);
    mockWorkspaceService.getMentionableUsers.mockReturnValue(apiRefresh.promise);

    const first = renderHook(() => useMentionableUsersWithAutoFetch(true));
    const second = renderHook(() => useMentionableUsersWithAutoFetch(true));

    await waitFor(() => {
      expect(toArray).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      diskLoad.resolve([]);
      await diskLoad.promise;
    });

    await waitFor(() => {
      expect(mockWorkspaceService.getMentionableUsers).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      apiRefresh.resolve(users);
      await apiRefresh.promise;
    });

    await waitFor(() => {
      expect(first.result.current.users).toBe(users);
      expect(second.result.current.users).toBe(users);
      expect(deleteProfiles).toHaveBeenCalledTimes(1);
      expect(mockProfiles.bulkPut).toHaveBeenCalledTimes(1);
    });
  });
});
