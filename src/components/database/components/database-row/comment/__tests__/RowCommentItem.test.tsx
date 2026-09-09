import { fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useState } from 'react';

import { RowComment } from '@/application/row-comment.type';

import { CommentDraftContext } from '../CommentDraftContext';
import { useRowCommentState } from '../RowCommentContext';
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
  useRowCommentState: jest.fn(() => ({
    editingCommentId: null,
    replyingCommentId: null,
    currentUserId: 'author-id',
    currentUserUid: 'author-uid',
    members: new Map([['author-id', { name: 'Lucas Xu' }]]),
  })),
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

  it('retains an unsaved comment edit while search hides its card and releases it after cancel', () => {
    const mockState = useRowCommentState as jest.MockedFunction<typeof useRowCommentState>;

    mockState.mockReturnValue({ ...mockState(), editingCommentId: baseComment.id });
    const comment = { ...baseComment, content: 'Original comment' };

    function RetainedComment({ visible }: { visible: boolean }) {
      const [hasDraft, setHasDraft] = useState(false);
      const notifyDraft = useCallback((_id: string, draft: boolean) => setHasDraft(draft), []);

      return (
        <CommentDraftContext.Provider value={notifyDraft}>
          {visible || hasDraft ? <div hidden={!visible}><RowCommentItem comment={comment} /></div> : null}
        </CommentDraftContext.Provider>
      );
    }

    const { rerender } = render(<RetainedComment visible />);
    const input = screen.getByRole<HTMLTextAreaElement>('textbox');

    fireEvent.change(input, { target: { value: 'Unsaved comment edit' } });
    rerender(<RetainedComment visible={false} />);
    expect(screen.getByRole('textbox', { hidden: true })).toBe(input);
    rerender(<RetainedComment visible />);
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('Unsaved comment edit');

    fireEvent.click(screen.getByTestId('row-comment-edit-cancel'));
    rerender(<RetainedComment visible={false} />);
    expect(screen.queryByRole('textbox', { hidden: true })).toBeNull();
  });
});
