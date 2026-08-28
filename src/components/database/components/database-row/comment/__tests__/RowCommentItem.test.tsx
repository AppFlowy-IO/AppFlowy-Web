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
    const mentionId = 'person-id-1';
    const mentionName = 'Test User';

    render(
      <RowCommentItem
        comment={{
          ...baseComment,
          content: `Message before @[${mentionName}](${mentionId}) message after`,
        }}
      />
    );

    const content = screen.getByTestId('row-comment-content');
    const mention = content.querySelector(`[data-mention-id="${mentionId}"]`);

    expect(mention).not.toBeNull();
    expect(mention?.textContent).toBe(`@${mentionName}`);
    expect(content.textContent).toBe(`Message before @${mentionName} message after`);
    expect(content.textContent).not.toContain(`@[${mentionName}](${mentionId})`);
  });
});
