import { render, screen } from '@testing-library/react';

import { RowComment } from '@/application/row-comment.type';

import RowCommentItem from '../RowCommentItem';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => options?.count ?? key,
  }),
}));

jest.mock('@/components/_shared/emoji-picker', () => ({
  EmojiPicker: () => null,
}));

jest.mock('../RowCommentContext', () => ({
  useRowCommentState: () => ({
    editingCommentId: null,
    replyingCommentId: null,
    currentUserId: 'author-id',
    currentUserUid: 'author-uid',
    members: new Map([['author-id', { name: 'Lucas Xu' }]]),
  }),
  useRowCommentDispatch: () => ({
    setEditingCommentId: jest.fn(),
    updateComment: jest.fn(),
    deleteComment: jest.fn(),
    resolveComment: jest.fn(),
    toggleReaction: jest.fn(),
  }),
}));

jest.mock('../MemberAvatar', () => ({
  __esModule: true,
  default: ({ uid }: { uid: string }) => <div data-testid='member-avatar'>{uid}</div>,
  getMemberDisplayName: (_members: Map<string, { name?: string }>, authorId: string) => authorId,
}));

jest.mock('../RowCommentReactions', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../AddCommentInput', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../DeleteCommentConfirm', () => ({
  __esModule: true,
  default: () => null,
}));

const baseComment: RowComment = {
  id: 'comment-id',
  parentCommentId: null,
  content: '',
  authorId: 'author-id',
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
  isResolved: false,
  resolvedBy: null,
  resolvedAt: null,
  reactions: {},
  attachments: [],
};

describe('RowCommentItem', () => {
  it('renders desktop-created person mentions as inline mention chips', () => {
    render(
      <RowCommentItem
        comment={{
          ...baseComment,
          content: 'Yes, I can receive it. @[Lucas Xu](6dd44664-b739-4aa5-bfd7-4fbc6677d435) 编辑被人的',
        }}
      />
    );

    const content = screen.getByTestId('row-comment-content');
    const mention = content.querySelector('[data-mention-id="6dd44664-b739-4aa5-bfd7-4fbc6677d435"]');

    expect(mention).not.toBeNull();
    expect(mention?.textContent).toBe('@Lucas Xu');
    expect(content.textContent).toBe('Yes, I can receive it. @Lucas Xu 编辑被人的');
    expect(content.textContent).not.toContain('@[Lucas Xu](6dd44664-b739-4aa5-bfd7-4fbc6677d435)');
  });
});
