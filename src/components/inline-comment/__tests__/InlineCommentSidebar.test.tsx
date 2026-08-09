import { fireEvent, render, screen } from '@testing-library/react';

import { InlineComment } from '@/application/inline-comment';

import { InlineCommentSidebar } from '../InlineCommentSidebar';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const resolveComment = jest.fn().mockResolvedValue(undefined);
const setFilter = jest.fn();
const setPanelOpen = jest.fn();

let mockInlineCommentContext: Record<string, unknown>;

jest.mock('../InlineCommentContext', () => ({
  INLINE_COMMENT_DRAWER_WIDTH: 352,
  useInlineCommentContext: () => mockInlineCommentContext,
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
    comments,
    currentUserUuid: 'user-1',
    filter: 'open',
    focusedCommentId: null,
    isPanelOpen: true,
    loading: false,
    mutatingCommentIds: new Set(),
    reactions: [],
    createReply: jest.fn().mockResolvedValue(undefined),
    deleteComment: jest.fn().mockResolvedValue(undefined),
    focusComment: jest.fn(),
    resolveComment,
    setFilter,
    setPanelOpen,
    toggleReaction: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('InlineCommentSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setContext();
  });

  it('shows anchored open threads, their replies, and live selected text', () => {
    render(<InlineCommentSidebar />);

    expect(screen.getByText('Open thread')).not.toBeNull();
    expect(screen.getByText('Chronological reply')).not.toBeNull();
    expect(screen.getByText('selected text')).not.toBeNull();
    expect(screen.queryByText('Resolved thread')).toBeNull();
    expect(screen.queryByText('Missing anchor')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'inlineComment.resolved' }));
    expect(setFilter).toHaveBeenCalledWith('resolved');
  });

  it('resolves an open thread and reopens a resolved thread', () => {
    const { rerender } = render(<InlineCommentSidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'inlineComment.resolve' }));
    expect(resolveComment).toHaveBeenCalledWith('open-comment', true);

    setContext({ filter: 'resolved' });
    rerender(<InlineCommentSidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'inlineComment.reopen' }));
    expect(resolveComment).toHaveBeenCalledWith('resolved-comment', false);
  });

  it('keeps the list visible but hides mutation controls without comment permission', () => {
    setContext({ canComment: false });
    render(<InlineCommentSidebar />);

    expect(screen.getByText('Open thread')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'inlineComment.resolve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'inlineComment.reply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'inlineComment.delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'inlineComment.addReaction' })).toBeNull();
  });
});
