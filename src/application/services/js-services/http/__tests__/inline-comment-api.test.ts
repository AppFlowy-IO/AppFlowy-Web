const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();

jest.mock('../core', () => ({
  getAxios: () => ({
    get: mockGet,
    post: mockPost,
    put: mockPut,
    delete: mockDelete,
  }),
  executeAPIRequest: async (request: () => Promise<{ data: { data: unknown } }>) => {
    const response = await request();

    return response.data.data;
  },
  executeAPIVoidRequest: async (request: () => Promise<unknown>) => {
    await request();
  },
}));

import {
  applyInlineCommentAnchorUpdate,
  createInlineComment,
  createInlineCommentReaction,
  deleteInlineCommentReaction,
  getAllInlineComments,
  getInlineCommentReactions,
  resolveInlineComment,
} from '../inline-comment-api';

function inlineCommentResponse(overrides: Record<string, unknown> = {}) {
  return {
    user: { uuid: 'user-1', name: 'Ada', avatar_url: 'avatar.png' },
    comment_id: 'comment-1',
    view_id: 'view-1',
    block_id: 'block-1',
    content: 'Review this',
    reply_comment_id: null,
    is_resolved: false,
    is_deleted: false,
    can_be_deleted: true,
    created_at: '2026-08-09T00:00:00Z',
    updated_at: '2026-08-09T00:00:00Z',
    ...overrides,
  };
}

describe('inline comment HTTP API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads every page and maps the desktop wire fields', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: {
          data: {
            comments: [inlineCommentResponse()],
            has_more: true,
            next_offset: 100,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            comments: [inlineCommentResponse({ comment_id: 'comment-2', content: 'Second' })],
            has_more: false,
            next_offset: null,
          },
        },
      });

    await expect(getAllInlineComments('workspace-1', 'view-1')).resolves.toEqual([
      expect.objectContaining({
        commentId: 'comment-1',
        blockId: 'block-1',
        canBeDeleted: true,
        user: { uuid: 'user-1', name: 'Ada', avatarUrl: 'avatar.png' },
      }),
      expect.objectContaining({ commentId: 'comment-2', content: 'Second' }),
    ]);
    expect(mockGet).toHaveBeenNthCalledWith(1, '/api/workspace/workspace-1/document/view-1/inline-comment', {
      params: { limit: 100, offset: 0 },
    });
    expect(mockGet).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-1/document/view-1/inline-comment', {
      params: { limit: 100, offset: 100 },
    });
  });

  it('sends the desktop-compatible create and resolve payloads', async () => {
    mockPost.mockResolvedValue({ data: { data: { comment_id: 'comment-1' } } });
    mockPut.mockResolvedValue({ data: {} });

    await expect(
      createInlineComment('workspace-1', 'view-1', {
        content: 'Review this',
        blockId: 'block-1',
        replyCommentId: 'parent-1',
        mentionedUserUuids: ['user-2'],
      })
    ).resolves.toBe('comment-1');
    await resolveInlineComment('workspace-1', 'view-1', 'comment-1', true);

    expect(mockPost).toHaveBeenCalledWith('/api/workspace/workspace-1/document/view-1/inline-comment/v2', {
      content: 'Review this',
      block_id: 'block-1',
      reply_comment_id: 'parent-1',
      mentioned_user_uuids: ['user-2'],
    });
    expect(mockPut).toHaveBeenCalledWith('/api/workspace/workspace-1/document/view-1/inline-comment/resolve', {
      comment_id: 'comment-1',
      is_resolved: true,
    });
  });

  it.each([404, 405])('falls back to v1 when v2 returns HTTP %s', async (httpStatus) => {
    mockPost
      .mockRejectedValueOnce({ code: httpStatus, message: 'Unsupported v2 route', httpStatus })
      .mockResolvedValueOnce({ data: { data: undefined } });

    await expect(
      createInlineComment('workspace-1', 'view-1', {
        content: 'Reply',
        replyCommentId: 'parent-1',
      })
    ).resolves.toBeNull();

    const payload = {
      content: 'Reply',
      block_id: undefined,
      reply_comment_id: 'parent-1',
      mentioned_user_uuids: [],
    };

    expect(mockPost).toHaveBeenNthCalledWith(
      1,
      '/api/workspace/workspace-1/document/view-1/inline-comment/v2',
      payload
    );
    expect(mockPost).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-1/document/view-1/inline-comment', payload);
  });

  it('does not retry v1 after an ambiguous v2 create failure', async () => {
    const error = { code: -1, message: 'response lost' };

    mockPost.mockRejectedValueOnce(error);

    await expect(
      createInlineComment('workspace-1', 'view-1', {
        content: 'Review this',
        blockId: 'block-1',
      })
    ).rejects.toBe(error);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/workspace/workspace-1/document/view-1/inline-comment/v2',
      expect.any(Object)
    );
  });

  it('persists anchor-only updates through the comment-authorized endpoint', async () => {
    mockPut.mockResolvedValue({ data: {} });

    await applyInlineCommentAnchorUpdate('workspace-1', 'view-1', {
      commentId: 'comment-1',
      update: new Uint8Array([1, 2, 3]),
    });

    expect(mockPut).toHaveBeenCalledWith('/api/workspace/workspace-1/document/view-1/inline-comment/anchor', {
      comment_id: 'comment-1',
      doc_state: [1, 2, 3],
    });
  });

  it('maps and toggles reactions with the desktop wire contract', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: {
          reactions: [
            {
              reaction_type: '👍',
              react_users: [{ uuid: 'user-1', name: 'Ada', avatar_url: null }],
              comment_id: 'comment-1',
            },
          ],
        },
      },
    });
    mockPost.mockResolvedValue({ data: {} });
    mockDelete.mockResolvedValue({ data: {} });

    await expect(getInlineCommentReactions('workspace-1', 'view-1')).resolves.toEqual([
      {
        reactionType: '👍',
        reactUsers: [{ uuid: 'user-1', name: 'Ada', avatarUrl: null }],
        commentId: 'comment-1',
      },
    ]);
    await createInlineCommentReaction('workspace-1', 'view-1', 'comment-1', '👍');
    await deleteInlineCommentReaction('workspace-1', 'view-1', 'comment-1', '👍');

    const reactionUrl = '/api/workspace/workspace-1/document/view-1/inline-comment/reaction';

    expect(mockGet).toHaveBeenCalledWith(reactionUrl, { params: undefined });
    expect(mockPost).toHaveBeenCalledWith(reactionUrl, {
      reaction_type: '👍',
      comment_id: 'comment-1',
    });
    expect(mockDelete).toHaveBeenCalledWith(reactionUrl, {
      data: { reaction_type: '👍', comment_id: 'comment-1' },
    });
  });
});
