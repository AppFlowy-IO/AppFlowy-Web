import { act, fireEvent, render, screen } from '@testing-library/react';

import { InlineComment } from '@/application/inline-comment';

import { InlineCommentSidebar } from '../InlineCommentSidebar';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Interpolation values are appended so plural counts and reactor names stay
    // assertable while the key itself remains the readable label.
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${Object.values(options).join(',')}` : key,
  }),
}));

jest.mock('@/components/_shared/emoji-picker/EmojiPicker', () => ({
  __esModule: true,
  default: () => <div data-testid={'emoji-picker'} />,
}));

const createReply = jest.fn().mockResolvedValue(undefined);
const deleteComment = jest.fn().mockResolvedValue(undefined);
const resolveComment = jest.fn().mockResolvedValue(undefined);
const toggleReaction = jest.fn().mockResolvedValue(undefined);
const setFilter = jest.fn();
const setPanelOpen = jest.fn();

let mockInlineCommentContext: Record<string, unknown>;

// The sidebar reads from three narrowed contexts; one fixture object satisfies
// all of them because they are disjoint slices of the same provider state.
jest.mock('../InlineCommentContext', () => ({
  INLINE_COMMENT_DRAWER_WIDTH: 352,
  useInlineCommentActions: () => mockInlineCommentContext,
  useInlineCommentContext: () => mockInlineCommentContext,
  useInlineCommentStatus: () => mockInlineCommentContext,
}));

function comment(overrides: Partial<InlineComment> = {}): InlineComment {
  return {
    user: { uuid: 'user-1', name: 'Ada', avatarUrl: null },
    commentId: 'open-comment',
    viewId: 'view-1',
    blockId: 'block-1',
    content: 'Open thread',
    replyCommentId: null,
    isResolved: false,
    isDeleted: false,
    canBeDeleted: true,
    createdAt: '2026-08-09T00:00:00Z',
    updatedAt: '2026-08-09T00:00:00Z',
    ...overrides,
  };
}

const comments = [
  comment(),
  comment({
    commentId: 'reply-comment',
    content: 'Chronological reply',
    replyCommentId: 'open-comment',
    createdAt: '2026-08-09T00:01:00Z',
  }),
  comment({ commentId: 'resolved-comment', content: 'Resolved thread', isResolved: true }),
  comment({ commentId: 'orphan-comment', content: 'Missing anchor' }),
];

const anchors = new Map([
  [
    'open-comment',
    {
      commentId: 'open-comment',
      blockId: 'block-1',
      quotedText: 'selected text',
      range: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 8 },
      },
    },
  ],
  [
    'resolved-comment',
    {
      commentId: 'resolved-comment',
      blockId: 'block-1',
      quotedText: 'resolved selection',
      range: {
        anchor: { path: [0, 0], offset: 9 },
        focus: { path: [0, 0], offset: 17 },
      },
    },
  ],
]);

function setContext(overrides: Record<string, unknown> = {}) {
  mockInlineCommentContext = {
    active: true,
    anchors,
    canComment: true,
    canResolveAllComments: true,
    comments,
    currentUserUuid: 'user-1',
    filter: 'open',
    focusedCommentId: null,
    isPanelOpen: true,
    loading: false,
    mutatingCommentIds: new Set(),
    reactions: [],
    createReply,
    deleteComment,
    focusComment: jest.fn(),
    resolveComment,
    setFilter,
    setPanelOpen,
    toggleReaction,
    ...overrides,
  };
}

describe('InlineCommentSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setContext();
  });

  it('shows anchored open threads and live selected text', () => {
    render(<InlineCommentSidebar />);

    expect(screen.getByText('Open thread')).not.toBeNull();
    expect(screen.getByText('selected text')).not.toBeNull();
    expect(screen.queryByText('Resolved thread')).toBeNull();
    expect(screen.queryByText('Missing anchor')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'inlineComment.resolved' }));
    expect(setFilter).toHaveBeenCalledWith('resolved');
  });

  it('keeps replies behind the show replies toggle, like desktop', () => {
    render(<InlineCommentSidebar />);

    expect(screen.queryByText('Chronological reply')).toBeNull();

    fireEvent.click(screen.getByTestId('inline-comment-replies-toggle'));
    expect(screen.getByText('Chronological reply')).not.toBeNull();
    expect(screen.getByTestId('inline-comment-replies-toggle').textContent).toContain('inlineComment.hideReplies');

    fireEvent.click(screen.getByTestId('inline-comment-replies-toggle'));
    expect(screen.queryByText('Chronological reply')).toBeNull();
  });

  it('expands replies automatically when a reply is focused', () => {
    setContext({ focusedCommentId: 'reply-comment' });
    render(<InlineCommentSidebar />);

    expect(screen.getByText('Chronological reply')).not.toBeNull();
  });

  it('resolves an open thread and reopens a resolved thread', () => {
    const { rerender } = render(<InlineCommentSidebar />);

    fireEvent.click(screen.getByTestId('inline-comment-resolve-button'));
    expect(resolveComment).toHaveBeenCalledWith('open-comment', true);

    setContext({ filter: 'resolved' });
    rerender(<InlineCommentSidebar />);

    fireEvent.click(screen.getByTestId('inline-comment-resolve-button'));
    expect(resolveComment).toHaveBeenCalledWith('resolved-comment', false);
  });

  it('never offers resolve for replies', () => {
    render(<InlineCommentSidebar />);

    fireEvent.click(screen.getByTestId('inline-comment-replies-toggle'));

    expect(screen.getByTestId('inline-comment-resolve-button')).not.toBeNull();
    expect(screen.queryByTestId('inline-comment-resolve-button-reply-comment')).toBeNull();
  });

  it('hides resolve from a non-author with comment-only access', () => {
    setContext({
      canResolveAllComments: false,
      comments: [comment({ canBeDeleted: false })],
      currentUserUuid: 'user-2',
    });
    render(<InlineCommentSidebar />);

    expect(screen.queryByTestId('inline-comment-resolve-button')).toBeNull();
    expect(screen.getByTestId('inline-comment-reply-button')).not.toBeNull();
  });

  it('opens a reply composer from the thread reply action', async () => {
    render(<InlineCommentSidebar />);

    fireEvent.click(screen.getByTestId('inline-comment-reply-button'));

    const input = screen.getByTestId('inline-comment-reply-input');

    fireEvent.change(input, { target: { value: 'Sounds good' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(createReply).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(createReply).toHaveBeenCalledWith('open-comment', 'Sounds good');
  });

  it('deletes a thread through the action menu and its confirmation', async () => {
    render(<InlineCommentSidebar />);

    expect(screen.queryByTestId('inline-comment-delete-button')).toBeNull();

    fireEvent.click(screen.getByTestId('inline-comment-action-menu-button'));
    fireEvent.click(screen.getByTestId('inline-comment-delete-button'));
    expect(deleteComment).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'inlineComment.delete' });

    expect(screen.getByTestId('inline-comment-sidebar').contains(dialog)).toBe(true);
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('globalComment.confirmDeleteDescription')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('inline-comment-delete-confirm-button'));
    });
    expect(deleteComment).toHaveBeenCalledWith('open-comment');
  });

  it('labels the reply toggle by count and expands when a new reply arrives', () => {
    const { rerender } = render(<InlineCommentSidebar />);

    expect(screen.getByTestId('inline-comment-replies-toggle').textContent).toContain('inlineComment.showReplies:1');

    setContext({
      comments: [
        ...comments,
        comment({
          commentId: 'second-reply',
          content: 'Another reply',
          replyCommentId: 'open-comment',
          createdAt: '2026-08-09T00:02:00Z',
        }),
      ],
    });
    rerender(<InlineCommentSidebar />);

    // Desktop expands the thread as soon as a reply lands.
    expect(screen.getByTestId('inline-comment-replies-toggle').textContent).toContain('inlineComment.hideReplies:2');
    expect(screen.getByText('Another reply')).not.toBeNull();
  });

  it('renders reaction chips and toggles a reaction', () => {
    setContext({
      reactions: [
        {
          commentId: 'open-comment',
          reactionType: '👍',
          reactUsers: [
            { uuid: 'user-1', name: 'Ada', avatarUrl: null },
            { uuid: 'user-2', name: 'Linus', avatarUrl: null },
          ],
        },
        // A reaction nobody holds anymore must not leave an empty chip behind.
        { commentId: 'open-comment', reactionType: '🎉', reactUsers: [] },
      ],
    });
    render(<InlineCommentSidebar />);

    const chip = screen.getByTestId('inline-comment-reaction-👍');

    expect(chip.textContent).toContain('2');
    expect(screen.queryByTestId('inline-comment-reaction-🎉')).toBeNull();
    // The current user already reacted, so the label offers to remove it.
    expect(chip.getAttribute('aria-label')).toContain('inlineComment.removeReaction');

    fireEvent.click(chip);
    expect(toggleReaction).toHaveBeenCalledWith('open-comment', '👍');
  });

  it('keeps the reaction portal inside the elevated sidebar stack', async () => {
    render(<InlineCommentSidebar elevated={true} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('inline-comment-add-reaction-button'));
      await Promise.resolve();
    });

    expect(screen.getByTestId('emoji-picker')).not.toBeNull();
    expect(
      screen.getByTestId('inline-comment-sidebar').contains(document.querySelector('[data-slot="popover-content"]'))
    ).toBe(true);
  });

  it('renders reaction chips as read-only without comment permission', () => {
    setContext({
      canComment: false,
      reactions: [
        {
          commentId: 'open-comment',
          reactionType: '👍',
          reactUsers: [{ uuid: 'user-2', name: 'Linus', avatarUrl: null }],
        },
      ],
    });
    render(<InlineCommentSidebar />);

    const chip = screen.getByTestId('inline-comment-reaction-👍');

    expect(chip.hasAttribute('disabled')).toBe(true);
    expect(chip.getAttribute('aria-label')).toContain('inlineComment.addReactionLabel');
  });

  it('renders desktop person mentions inside the comment body', () => {
    setContext({
      comments: [comment({ content: 'Ping @[Ada Lovelace](user-2) about the layout' })],
    });
    render(<InlineCommentSidebar />);

    const mention = screen.getByText('@Ada Lovelace');

    expect(mention.getAttribute('data-mention-id')).toBe('user-2');
    // The raw desktop mention syntax must not leak into the rendered body.
    expect(screen.queryByText(/@\[Ada Lovelace\]/)).toBeNull();
  });

  it('renders the deleted placeholder instead of the original content', () => {
    setContext({
      comments: [
        comment(),
        comment({
          commentId: 'deleted-reply',
          content: 'Reply that was removed',
          replyCommentId: 'open-comment',
          isDeleted: true,
          createdAt: '2026-08-09T00:01:00Z',
        }),
      ],
    });
    render(<InlineCommentSidebar />);

    // A deleted reply drops out of the thread entirely, like desktop.
    expect(screen.queryByText('Reply that was removed')).toBeNull();
    expect(screen.queryByTestId('inline-comment-replies-toggle')).toBeNull();
  });

  it('truncates a long comment behind see more', () => {
    const longContent = 'x'.repeat(200);

    setContext({ comments: [comment({ content: longContent })] });
    render(<InlineCommentSidebar />);

    const truncated = screen.getByTestId('inline-comment-see-more');

    expect(truncated.textContent).toContain('inlineComment.seeMore');
    expect(truncated.textContent).not.toContain(longContent);

    fireEvent.click(truncated);
    expect(screen.getByText(longContent)).not.toBeNull();
  });

  it('shows the empty state matching the active filter', () => {
    setContext({ comments: [] });
    const { rerender } = render(<InlineCommentSidebar />);

    expect(screen.getByTestId('inline-comment-empty').textContent).toContain('inlineComment.noOpenComments');

    setContext({ comments: [], filter: 'resolved' });
    rerender(<InlineCommentSidebar />);
    expect(screen.getByTestId('inline-comment-empty').textContent).toContain('inlineComment.noResolvedComments');

    setContext({ comments: [], filter: 'all' });
    rerender(<InlineCommentSidebar />);
    expect(screen.getByTestId('inline-comment-empty').textContent).toContain('inlineComment.noComments');
  });

  it('keeps the list visible but hides mutation controls without comment permission', () => {
    setContext({ canComment: false });
    render(<InlineCommentSidebar />);

    expect(screen.getByText('Open thread')).not.toBeNull();
    expect(screen.queryByTestId('inline-comment-resolve-button')).toBeNull();
    expect(screen.queryByTestId('inline-comment-reply-button')).toBeNull();
    expect(screen.queryByTestId('inline-comment-action-menu-button')).toBeNull();
    expect(screen.queryByTestId('inline-comment-add-reaction-button')).toBeNull();
  });
});
