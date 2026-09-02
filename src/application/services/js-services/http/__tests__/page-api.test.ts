import { ERROR_CODE } from '@/application/constants';
import {
  AccessLevel,
  isLegacyCompatibleSpaceVisibility,
  legacySpacePermission,
  SpaceInvitePolicy,
  SpacePermission,
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
  ViewLayout,
} from '@/application/types';
import { executeAPIRequest, executeAPIVoidRequest, getAxios } from '@/application/services/js-services/http/core';

import {
  createSpace,
  createSpaceWithInitialPage,
  getDatabaseContainerUpgradeStatus,
  upgradeDatabaseContainer,
} from '../page-api';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'generated-space-id'),
}));

jest.mock('@/application/services/js-services/http/core', () => ({
  executeAPIRequest: jest.fn(),
  executeAPIVoidRequest: jest.fn(),
  getAxios: jest.fn(),
}));

const privatePermission: SpacePermissionSettings = {
  visibility: SpaceVisibility.Private,
  owner_access_level: AccessLevel.FullAccess,
  member_default_access_level: AccessLevel.ReadAndWrite,
  invite_policy: SpaceInvitePolicy.OwnersOnly,
  sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly,
  invite_link_enabled: false,
  security: {
    disable_guests: false,
    disable_public_links: false,
    disable_export: false,
  },
};

const structuredPrivatePermission: SpacePermissionSettings = {
  ...privatePermission,
  member_default_access_level: AccessLevel.ReadOnly,
};

function apiResponse<T>(data: T) {
  return {
    data: {
      code: 0,
      message: '',
      data,
    },
  };
}

describe('createSpaceWithInitialPage', () => {
  const post = jest.fn();
  const deleteRequest = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getAxios).mockReturnValue({ post, delete: deleteRequest } as never);
    (executeAPIRequest as jest.Mock).mockImplementation(
      async (request: () => Promise<ReturnType<typeof apiResponse>>) => {
        const response = await request();

        return response.data.data;
      }
    );
    (executeAPIVoidRequest as jest.Mock).mockImplementation(async (request: () => Promise<unknown>) => {
      await request();
    });
  });

  it('preserves a structured Private ACL while composing space and initial-page creation', async () => {
    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') return apiResponse({ view_id: 'space-id' });
      if (url === '/api/workspace/workspace-id/page-view') return apiResponse({ view_id: 'page-id' });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Private space',
        space_icon: 'icon',
        space_icon_color: '#000000',
        view_id: 'space-id',
        permission: structuredPrivatePermission,
        // Even a compatibility value must never route the structured request
        // through the lossy legacy endpoint or reach the structured endpoint.
        space_permission: SpacePermission.Public,
        initial_page: {
          layout: ViewLayout.Document,
          name: 'First page',
          page_data: { blocks: [] },
          view_id: 'page-id',
          prev_view_id: null,
        },
      })
    ).resolves.toEqual({
      space: { view_id: 'space-id' },
      page: { view_id: 'page-id' },
    });

    expect(post).toHaveBeenNthCalledWith(1, '/api/workspace/workspace-id/spaces', {
      name: 'Private space',
      space_icon: 'icon',
      space_icon_color: '#000000',
      view_id: 'space-id',
      permission: structuredPrivatePermission,
    });
    expect(post).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-id/page-view', {
      parent_view_id: 'space-id',
      layout: ViewLayout.Document,
      name: 'First page',
      page_data: { blocks: [] },
      view_id: 'page-id',
      collab_id: 'page-id',
      prev_view_id: null,
    });
    expect(post.mock.calls.map(([url]) => url)).not.toContain('/api/workspace/workspace-id/v2/space');
    expect(deleteRequest).not.toHaveBeenCalled();
  });

  it('removes an internally identified structured space when creating its initial page fails', async () => {
    const pageError = new Error('initial page failed');
    const requestOrder: string[] = [];

    post.mockImplementation(async (url: string) => {
      requestOrder.push(url);
      if (url === '/api/workspace/workspace-id/spaces') return apiResponse({ view_id: 'generated-space-id' });
      if (url === '/api/workspace/workspace-id/page-view') throw pageError;
      if (url === '/api/workspace/workspace-id/page-view/generated-space-id/move-to-trash') {
        return apiResponse(undefined);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    deleteRequest.mockImplementation(async (url: string) => {
      requestOrder.push(url);
      return apiResponse(undefined);
    });

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Private space',
        space_icon: '',
        space_icon_color: '',
        permission: structuredPrivatePermission,
        initial_page: { layout: ViewLayout.Document },
      })
    ).rejects.toBe(pageError);

    expect(requestOrder).toEqual([
      '/api/workspace/workspace-id/spaces',
      '/api/workspace/workspace-id/page-view',
      '/api/workspace/workspace-id/page-view/generated-space-id/move-to-trash',
      '/api/workspace/workspace-id/trash/generated-space-id',
    ]);
    const pageRequestBody = post.mock.calls.find(([url]) => url === '/api/workspace/workspace-id/page-view')?.[1];

    expect(pageRequestBody).not.toHaveProperty('view_id');
    expect(pageRequestBody).not.toHaveProperty('collab_id');
  });

  it('does not remove a caller-owned space ID when initial-page creation fails', async () => {
    const pageError = new Error('initial page failed');

    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') return apiResponse({ view_id: 'explicit-space-id' });
      if (url === '/api/workspace/workspace-id/page-view') throw pageError;
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Private space',
        space_icon: '',
        space_icon_color: '',
        view_id: 'explicit-space-id',
        permission: structuredPrivatePermission,
        initial_page: { layout: ViewLayout.Document },
      })
    ).rejects.toBe(pageError);

    expect(post).toHaveBeenCalledTimes(2);
    expect(deleteRequest).not.toHaveBeenCalled();
  });

  it('does not trash a caller-owned ID when structured creation rejects', async () => {
    const createError = new Error('response lost');

    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') throw createError;
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Private space',
        space_icon: '',
        space_icon_color: '',
        view_id: 'requested-space-id',
        permission: structuredPrivatePermission,
        initial_page: { layout: ViewLayout.Document },
      })
    ).rejects.toBe(createError);

    expect(post).toHaveBeenCalledTimes(1);
    expect(deleteRequest).not.toHaveBeenCalled();
  });

  it('uses a fresh internal ID to clean up an ambiguous structured-create failure', async () => {
    const createError = new Error('response lost');

    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') throw createError;
      if (url === '/api/workspace/workspace-id/page-view/generated-space-id/move-to-trash') {
        return apiResponse(undefined);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Private space',
        space_icon: '',
        space_icon_color: '',
        permission: structuredPrivatePermission,
        initial_page: { layout: ViewLayout.Document },
      })
    ).rejects.toBe(createError);

    expect(createError).toMatchObject({ clientGeneratedCleanupSucceeded: true });

    expect(post).toHaveBeenNthCalledWith(
      1,
      '/api/workspace/workspace-id/spaces',
      expect.objectContaining({ view_id: 'generated-space-id' })
    );
    expect(post).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-id/page-view/generated-space-id/move-to-trash');
    expect(deleteRequest).toHaveBeenCalledWith('/api/workspace/workspace-id/trash/generated-space-id');
  });

  it('marks an ambiguous client-generated create when permanent cleanup cannot be confirmed', async () => {
    const createError = new Error('response lost');

    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') throw createError;
      if (url === '/api/workspace/workspace-id/page-view/draft-space-id/move-to-trash') {
        throw new Error('trash unavailable');
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    deleteRequest.mockRejectedValue(new Error('delete unavailable'));

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Draft space',
        view_id: 'draft-space-id',
        client_generated_view_id: true,
        permission: structuredPrivatePermission,
        initial_page: { layout: ViewLayout.Document, view_id: 'draft-page-id' },
      })
    ).rejects.toBe(createError);

    expect(createError).toMatchObject({ clientGeneratedCleanupSucceeded: false });
    expect(post).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-id/page-view/draft-space-id/move-to-trash');
    expect(deleteRequest).toHaveBeenCalledWith('/api/workspace/workspace-id/trash/draft-space-id');
  });

  it('treats a confirmed move to trash as compensation even when permanent purge fails', async () => {
    const createError = new Error('response lost');

    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') throw createError;
      if (url === '/api/workspace/workspace-id/page-view/draft-space-id/move-to-trash') {
        return apiResponse(undefined);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    deleteRequest.mockRejectedValue(new Error('delete unavailable'));

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Draft space',
        view_id: 'draft-space-id',
        client_generated_view_id: true,
        permission: structuredPrivatePermission,
        initial_page: { layout: ViewLayout.Document, view_id: 'draft-page-id' },
      })
    ).rejects.toBe(createError);

    expect(createError).toMatchObject({ clientGeneratedCleanupSucceeded: true });
  });

  it('does not compensate or mark a definitive structured space-create rejection as ambiguous', async () => {
    const createError = { code: 422, httpStatus: 422, message: 'invalid space name' };

    post.mockRejectedValue(createError);
    deleteRequest.mockRejectedValue(new Error('cleanup unavailable'));

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Rejected draft',
        view_id: 'draft-space-id',
        client_generated_view_id: true,
        permission: structuredPrivatePermission,
        initial_page: { layout: ViewLayout.Document, view_id: 'draft-page-id' },
      })
    ).rejects.toBe(createError);

    expect(createError).not.toHaveProperty('clientGeneratedCleanupSucceeded');
    expect(post).toHaveBeenCalledTimes(1);
    expect(deleteRequest).not.toHaveBeenCalled();
  });

  it('owns an explicitly client-generated ID and cleans it up when page creation fails', async () => {
    const pageError = new Error('initial page failed');

    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') return apiResponse({ view_id: 'draft-space-id' });
      if (url === '/api/workspace/workspace-id/page-view') throw pageError;
      if (url === '/api/workspace/workspace-id/page-view/draft-space-id/move-to-trash') {
        return apiResponse(undefined);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    deleteRequest.mockResolvedValue(apiResponse(undefined));

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Draft space',
        view_id: 'draft-space-id',
        client_generated_view_id: true,
        permission: structuredPrivatePermission,
        initial_page: { layout: ViewLayout.Document, view_id: 'draft-page-id' },
      })
    ).rejects.toBe(pageError);

    expect(post).toHaveBeenNthCalledWith(1, '/api/workspace/workspace-id/spaces', {
      name: 'Draft space',
      view_id: 'draft-space-id',
      permission: structuredPrivatePermission,
    });
    expect(post).toHaveBeenNthCalledWith(3, '/api/workspace/workspace-id/page-view/draft-space-id/move-to-trash');
    expect(deleteRequest).toHaveBeenCalledWith('/api/workspace/workspace-id/trash/draft-space-id');
  });

  it('rejects a mismatched client-generated space response and compensates only the requested space', async () => {
    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') return apiResponse({ view_id: 'unexpected-space-id' });
      if (url === '/api/workspace/workspace-id/page-view/draft-space-id/move-to-trash') {
        return apiResponse(undefined);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    deleteRequest.mockResolvedValue(apiResponse(undefined));

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Draft space',
        view_id: 'draft-space-id',
        client_generated_view_id: true,
        permission: structuredPrivatePermission,
        initial_page: { layout: ViewLayout.Document, view_id: 'draft-page-id' },
      })
    ).rejects.toMatchObject({
      code: -1,
      clientGeneratedExpectedViewId: 'draft-space-id',
      clientGeneratedReturnedViewId: 'unexpected-space-id',
      clientGeneratedCleanupSucceeded: true,
    });

    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith('/api/workspace/workspace-id/page-view/draft-space-id/move-to-trash');
    expect(deleteRequest).toHaveBeenCalledWith('/api/workspace/workspace-id/trash/draft-space-id');
  });

  it('rejects a mismatched initial-page response before handoff and removes its client-owned parent', async () => {
    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') return apiResponse({ view_id: 'draft-space-id' });
      if (url === '/api/workspace/workspace-id/page-view') return apiResponse({ view_id: 'unexpected-page-id' });
      if (url === '/api/workspace/workspace-id/page-view/draft-space-id/move-to-trash') {
        return apiResponse(undefined);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    deleteRequest.mockResolvedValue(apiResponse(undefined));

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Draft space',
        view_id: 'draft-space-id',
        client_generated_view_id: true,
        permission: structuredPrivatePermission,
        initial_page: { layout: ViewLayout.Document, view_id: 'draft-page-id' },
      })
    ).rejects.toMatchObject({
      code: -1,
      clientGeneratedExpectedViewId: 'draft-page-id',
      clientGeneratedReturnedViewId: 'unexpected-page-id',
      clientGeneratedCleanupSucceeded: true,
    });

    expect(deleteRequest).toHaveBeenCalledWith('/api/workspace/workspace-id/trash/draft-space-id');
  });

  it('reconciles AlreadyExists for exact client-generated space and page IDs on retry', async () => {
    const alreadyExists = {
      code: ERROR_CODE.RECORD_ALREADY_EXISTS,
      message: 'already exists',
      httpStatus: 409,
    };

    post.mockRejectedValue(alreadyExists);

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Draft space',
        view_id: 'draft-space-id',
        client_generated_view_id: true,
        permission: structuredPrivatePermission,
        initial_page: { layout: ViewLayout.Document, view_id: 'draft-page-id' },
      })
    ).resolves.toEqual({
      space: { view_id: 'draft-space-id' },
      page: { view_id: 'draft-page-id' },
    });

    expect(post).toHaveBeenNthCalledWith(1, '/api/workspace/workspace-id/spaces', {
      name: 'Draft space',
      view_id: 'draft-space-id',
      permission: structuredPrivatePermission,
    });
    expect(post).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-id/page-view', {
      parent_view_id: 'draft-space-id',
      layout: ViewLayout.Document,
      name: undefined,
      page_data: undefined,
      view_id: 'draft-page-id',
      collab_id: 'draft-page-id',
      prev_view_id: undefined,
    });
    expect(deleteRequest).not.toHaveBeenCalled();
  });

  it('keeps the legacy atomic endpoint for callers without structured permissions', async () => {
    const response = {
      space: { view_id: 'legacy-space-id' },
      page: { view_id: 'legacy-page-id' },
    };

    post.mockResolvedValue(apiResponse(response));

    const payload = {
      name: 'Legacy space',
      space_icon: '',
      space_icon_color: '',
      space_permission: SpacePermission.Private,
      initial_page: { layout: ViewLayout.Document },
    };

    await expect(createSpaceWithInitialPage('workspace-id', payload)).resolves.toEqual(response);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/workspace/workspace-id/v2/space', payload);
  });

  it.each([
    ['missing', undefined, 'legacy-page-id'],
    ['mismatched space', 'other-space-id', 'legacy-page-id'],
    ['mismatched page', 'legacy-space-id', 'other-page-id'],
  ])('rejects a %s atomic response for explicit client-generated IDs', async (_label, spaceId, pageId) => {
    post.mockResolvedValue(
      apiResponse({
        space: { view_id: spaceId },
        page: { view_id: pageId },
      })
    );

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Legacy retry space',
        view_id: 'legacy-space-id',
        client_generated_view_id: true,
        space_permission: SpacePermission.Private,
        initial_page: { layout: ViewLayout.Document, view_id: 'legacy-page-id' },
      })
    ).rejects.toMatchObject({ code: -1 });
  });

  it.each([
    [SpaceVisibility.Public, SpacePermission.Private],
    [SpaceVisibility.Private, SpacePermission.Public],
  ])('uses structured endpoints for a default %s permission draft', async (visibility, staleLegacyPermission) => {
    const permission = { ...privatePermission, visibility };

    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') return apiResponse({ view_id: 'space-id' });
      if (url === '/api/workspace/workspace-id/page-view') return apiResponse({ view_id: 'page-id' });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Default space',
        space_icon: '',
        space_icon_color: '',
        view_id: 'space-id',
        client_generated_view_id: true,
        permission,
        // The structured visibility is authoritative when both forms are
        // present, so a stale compatibility field cannot select a legacy path.
        space_permission: staleLegacyPermission,
        initial_page: { layout: ViewLayout.Document, view_id: 'page-id' },
      })
    ).resolves.toEqual({
      space: { view_id: 'space-id' },
      page: { view_id: 'page-id' },
    });

    expect(post).toHaveBeenNthCalledWith(1, '/api/workspace/workspace-id/spaces', {
      name: 'Default space',
      space_icon: '',
      space_icon_color: '',
      view_id: 'space-id',
      permission,
    });
    expect(post).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-id/page-view', {
      parent_view_id: 'space-id',
      layout: ViewLayout.Document,
      name: undefined,
      page_data: undefined,
      view_id: 'page-id',
      collab_id: 'page-id',
      prev_view_id: undefined,
    });
    expect(post.mock.calls.map(([url]) => url)).not.toContain('/api/workspace/workspace-id/v2/space');
    expect(deleteRequest).not.toHaveBeenCalled();
  });
});

describe('upgradeDatabaseContainer', () => {
  it('gets the server-authoritative upgrade eligibility', async () => {
    const get = jest.fn().mockResolvedValue(
      apiResponse({
        eligible: true,
        already_upgraded: false,
      })
    );

    jest.mocked(getAxios).mockReturnValue({ get } as never);
    (executeAPIRequest as jest.Mock).mockImplementationOnce(
      async (request: () => Promise<ReturnType<typeof apiResponse>>) => (await request()).data.data
    );

    await expect(getDatabaseContainerUpgradeStatus('workspace-id', 'database-view-id')).resolves.toEqual({
      eligible: true,
      already_upgraded: false,
    });
    expect(get).toHaveBeenCalledWith(
      '/api/workspace/workspace-id/page-view/database-view-id/upgrade-database-container'
    );
  });

  it('posts to the legacy database upgrade endpoint and returns its IDs', async () => {
    const post = jest.fn().mockResolvedValue(
      apiResponse({
        database_id: 'database-id',
        database_view_id: 'database-view-id',
        container_view_id: 'container-view-id',
        upgraded: true,
      })
    );

    jest.mocked(getAxios).mockReturnValue({ post } as never);
    (executeAPIRequest as jest.Mock).mockImplementationOnce(
      async (request: () => Promise<ReturnType<typeof apiResponse>>) => (await request()).data.data
    );

    await expect(upgradeDatabaseContainer('workspace-id', 'database-view-id')).resolves.toEqual({
      database_id: 'database-id',
      database_view_id: 'database-view-id',
      container_view_id: 'container-view-id',
      upgraded: true,
    });
    expect(post).toHaveBeenCalledWith(
      '/api/workspace/workspace-id/page-view/database-view-id/upgrade-database-container'
    );
  });
});

describe('createSpace legacy fallback', () => {
  const post = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getAxios).mockReturnValue({ post } as never);
    (executeAPIRequest as jest.Mock).mockImplementation(
      async (request: () => Promise<ReturnType<typeof apiResponse>>) => {
        const response = await request();

        return response.data.data;
      }
    );
  });

  const endpointMissing = { code: 404, message: 'Not Found', httpStatus: 404 };

  function structuredPayload(visibility: SpaceVisibility): SpacePermissionSettings {
    return { ...privatePermission, visibility };
  }

  it.each([
    [SpaceVisibility.Public, SpacePermission.Public],
    [SpaceVisibility.Private, SpacePermission.Private],
  ])('downgrades %s visibility to the legacy binary permission on a 404', async (visibility, expectedLegacy) => {
    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') throw endpointMissing;
      if (url === '/api/workspace/workspace-id/space') return apiResponse({ view_id: 'space-id' });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      createSpace('workspace-id', { name: 'A space', permission: structuredPayload(visibility) })
    ).resolves.toBe('space-id');

    expect(post).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-id/space', {
      name: 'A space',
      space_permission: expectedLegacy,
    });
  });

  it('does not downgrade an edited Public ACL when the structured endpoint is unavailable', async () => {
    const editedPublicPermission = {
      ...structuredPayload(SpaceVisibility.Public),
      member_default_access_level: AccessLevel.ReadOnly,
    };

    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') throw endpointMissing;
      if (url === '/api/workspace/workspace-id/space') return apiResponse({ view_id: 'space-id' });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      createSpace('workspace-id', { name: 'Edited public space', permission: editedPublicPermission })
    ).rejects.toBe(endpointMissing);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls.map(([url]) => url)).not.toContain('/api/workspace/workspace-id/space');
  });

  it('rethrows structured-endpoint failures that are not endpoint-unavailable', async () => {
    const serverError = { code: 500, message: 'boom', httpStatus: 500 };

    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') throw serverError;
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(createSpace('workspace-id', { name: 'A space', permission: privatePermission })).rejects.toBe(
      serverError
    );

    expect(post).toHaveBeenCalledTimes(1);
  });

  it('creates a custom space through the structured endpoint only', async () => {
    const customPermission = structuredPayload(SpaceVisibility.Custom);

    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') return apiResponse({ view_id: 'custom-space-id' });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      createSpace('workspace-id', {
        name: 'Custom space',
        permission: customPermission,
        // A stray compatibility value must never reach either endpoint.
        space_permission: SpacePermission.Private,
      })
    ).resolves.toBe('custom-space-id');

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/workspace/workspace-id/spaces', {
      name: 'Custom space',
      permission: customPermission,
    });
  });

  it('reuses an exact client-generated ID after an ambiguous response without leaking the retry marker', async () => {
    const transportError = { code: -1, message: 'response lost' };
    const alreadyExists = {
      code: ERROR_CODE.RECORD_ALREADY_EXISTS,
      message: 'already exists',
      httpStatus: 409,
    };
    const payload = {
      name: 'Idempotent draft',
      view_id: 'draft-space-id',
      client_generated_view_id: true,
      permission: privatePermission,
    };

    post.mockRejectedValueOnce(transportError).mockRejectedValueOnce(alreadyExists);

    await expect(createSpace('workspace-id', payload)).rejects.toBe(transportError);
    await expect(createSpace('workspace-id', payload)).resolves.toBe('draft-space-id');

    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, '/api/workspace/workspace-id/spaces', {
      name: 'Idempotent draft',
      view_id: 'draft-space-id',
      permission: privatePermission,
    });
    expect(post).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-id/spaces', {
      name: 'Idempotent draft',
      view_id: 'draft-space-id',
      permission: privatePermission,
    });
  });

  it('does not silently downgrade a custom space to the legacy endpoint on a 404', async () => {
    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') throw endpointMissing;
      if (url === '/api/workspace/workspace-id/space') return apiResponse({ view_id: 'space-id' });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      createSpace('workspace-id', { name: 'Custom space', permission: structuredPayload(SpaceVisibility.Custom) })
    ).rejects.toBe(endpointMissing);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls.map(([url]) => url)).not.toContain('/api/workspace/workspace-id/space');
  });
});

describe('legacy space permission mapping', () => {
  it.each([
    [SpaceVisibility.Public, SpacePermission.Public],
    [SpaceVisibility.Private, SpacePermission.Private],
    // Custom is non-private: its legacy marker is 0, like Public.
    [SpaceVisibility.Custom, SpacePermission.Public],
    // A visibility this client does not know yet is public-like, never private.
    ['invite_only' as SpaceVisibility, SpacePermission.Public],
  ])('maps %s visibility to legacy space_permission %s', (visibility, expectedLegacy) => {
    expect(legacySpacePermission(visibility)).toBe(expectedLegacy);
  });

  it.each([
    [SpaceVisibility.Public, true],
    [SpaceVisibility.Private, true],
    [SpaceVisibility.Custom, false],
    ['invite_only' as SpaceVisibility, false],
  ])('treats %s visibility as legacy-compatible: %s', (visibility, expected) => {
    expect(isLegacyCompatibleSpaceVisibility(visibility)).toBe(expected);
  });
});
