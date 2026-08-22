import {
  AccessLevel,
  SpaceInvitePolicy,
  SpacePermission,
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
  ViewLayout,
} from '@/application/types';
import { executeAPIRequest, executeAPIVoidRequest, getAxios } from '@/application/services/js-services/http/core';

import { createSpace, createSpaceWithInitialPage } from '../page-api';

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
        permission: privatePermission,
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
      permission: privatePermission,
    });
    expect(post).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-id/page-view', {
      parent_view_id: 'space-id',
      layout: ViewLayout.Document,
      name: 'First page',
      page_data: { blocks: [] },
      view_id: 'page-id',
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
        permission: privatePermission,
        initial_page: { layout: ViewLayout.Document },
      })
    ).rejects.toBe(pageError);

    expect(requestOrder).toEqual([
      '/api/workspace/workspace-id/spaces',
      '/api/workspace/workspace-id/page-view',
      '/api/workspace/workspace-id/page-view/generated-space-id/move-to-trash',
      '/api/workspace/workspace-id/trash/generated-space-id',
    ]);
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
        permission: privatePermission,
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
        permission: privatePermission,
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
        permission: privatePermission,
        initial_page: { layout: ViewLayout.Document },
      })
    ).rejects.toBe(createError);

    expect(post).toHaveBeenNthCalledWith(
      1,
      '/api/workspace/workspace-id/spaces',
      expect.objectContaining({ view_id: 'generated-space-id' })
    );
    expect(post).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-id/page-view/generated-space-id/move-to-trash');
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

  it('composes the legacy space and page endpoints when the structured endpoint is missing', async () => {
    const endpointMissing = { code: 404, message: 'Not Found', httpStatus: 404 };

    post.mockImplementation(async (url: string) => {
      if (url === '/api/workspace/workspace-id/spaces') throw endpointMissing;
      if (url === '/api/workspace/workspace-id/space') return apiResponse({ view_id: 'space-id' });
      if (url === '/api/workspace/workspace-id/page-view') return apiResponse({ view_id: 'page-id' });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      createSpaceWithInitialPage('workspace-id', {
        name: 'Private space',
        space_icon: '',
        space_icon_color: '',
        view_id: 'space-id',
        permission: privatePermission,
        initial_page: { layout: ViewLayout.Document, view_id: 'page-id' },
      })
    ).resolves.toEqual({
      space: { view_id: 'space-id' },
      page: { view_id: 'page-id' },
    });

    expect(post).toHaveBeenNthCalledWith(
      2,
      '/api/workspace/workspace-id/space',
      expect.objectContaining({ space_permission: SpacePermission.Private })
    );
    expect(deleteRequest).not.toHaveBeenCalled();
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
    // A visibility this client does not know yet is public-like, never private.
    ['custom' as SpaceVisibility, SpacePermission.Public],
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
});
