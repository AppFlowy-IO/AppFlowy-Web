import { fireEvent, render, screen } from '@testing-library/react';

import { COMMENT_MENTION_RANKING_OVERRIDE_KEY } from '@/application/comment-mention-ranking';
import { RowComment } from '@/application/row-comment.type';
import { MentionablePerson, MentionPersonRole } from '@/application/types';

import AddCommentInput from '../AddCommentInput';
import { RowCommentProvider } from '../RowCommentContext';

function member(uid: number, name: string): MentionablePerson {
  return {
    uid: String(uid),
    person_id: `00000000-0000-4000-8000-${String(uid).padStart(12, '0')}`,
    name,
    email: `${name.split(' ')[0].toLowerCase()}@appflowy.io`,
    role: MentionPersonRole.Member,
    avatar_url: null,
    cover_image_url: null,
    custom_image_url: null,
    description: null,
    invited: false,
    last_mentioned_at: null,
  };
}

const mockRoster = [
  member(1, 'Joan Diaz'),
  member(2, 'Brian Li'),
  member(3, 'Anna Kim'),
  member(4, 'Carol Wu'),
  // The commenter: first by name, so only the requester rule puts them last.
  member(5, 'Aaron Me'),
];
const [joan, , , carol, me] = mockRoster;

function comment(id: string, authorId: string, createdAt: number, parentCommentId: string | null = null): RowComment {
  return {
    id,
    parentCommentId,
    content: id,
    authorId,
    createdAt,
    updatedAt: createdAt,
    isResolved: false,
    resolvedBy: null,
    resolvedAt: null,
    reactions: {},
    attachments: [],
  };
}

// Joan started the thread, Brian replied in an older client that wrote his uid, and Carol started
// another thread later.
const mockComments = [
  comment('c1', joan.person_id, 100),
  comment('r1', '2', 200, 'c1'),
  comment('c2', carol.person_id, 300),
];

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: () => ({ uploadFile: jest.fn() }),
  useReadOnly: () => false,
}));
jest.mock('@/application/database-yjs/comment_dispatch', () => ({
  useAddCommentDispatch: () => jest.fn(),
  useDeleteCommentDispatch: () => jest.fn(),
  useResolveCommentDispatch: () => jest.fn(),
  useToggleCommentReactionDispatch: () => jest.fn(),
  useUpdateCommentDispatch: () => jest.fn(),
}));
jest.mock('@/application/database-yjs/comment_selector', () => ({
  useRowComments: () => ({ comments: mockComments, openComments: mockComments, loading: false, refresh: jest.fn() }),
}));
jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: () => ({ users: mockRoster, loading: false }),
}));
jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => ({ uuid: me.person_id, uid: me.uid, name: me.name, email: me.email }),
}));

function openPicker(parentCommentId?: string) {
  render(
    <RowCommentProvider rowId='row-1'>
      <AddCommentInput parentCommentId={parentCommentId} />
    </RowCommentProvider>
  );
  if (!parentCommentId) fireEvent.click(screen.getByTestId('row-comment-collapsed-input'));
  fireEvent.change(screen.getByTestId('row-comment-input'), { target: { value: '@' } });
  return screen.getAllByRole('option').map((option) => option.textContent);
}

describe('row comment composer participants', () => {
  afterEach(() => window.localStorage.clear());

  it('keeps the roster order by default', () => {
    expect(openPicker('c1')).toEqual(['Joan Diaz', 'Brian Li', 'Anna Kim', 'Carol Wu', 'Aaron Me']);
  });

  it("ranks a reply's thread authors first, then the row's other commenters, the commenter last", () => {
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'ranked');
    expect(openPicker('c1')).toEqual(['Brian Li', 'Joan Diaz', 'Carol Wu', 'Anna Kim', 'Aaron Me']);
  });

  it('ranks every commenter on the row first for a new comment', () => {
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'ranked');
    expect(openPicker()).toEqual(['Carol Wu', 'Brian Li', 'Joan Diaz', 'Anna Kim', 'Aaron Me']);
  });
});
