import { fireEvent, render, screen } from '@testing-library/react';

import { COMMENT_MENTION_RANKING_OVERRIDE_KEY } from '@/application/comment-mention-ranking';
import { MentionablePerson, MentionPersonRole } from '@/application/types';

import { InlineCommentComposer } from '../InlineCommentComposer';

const mockPeople: MentionablePerson[] = ['Alice', 'Bob', 'Cy'].map((name, index) => ({
  person_id: `00000000-0000-4000-8000-00000000000${index + 1}`,
  uid: index + 1,
  name,
  email: `${name.toLowerCase()}@appflowy.io`,
  role: MentionPersonRole.Member,
  avatar_url: null,
  cover_image_url: null,
  custom_image_url: null,
  description: null,
  invited: false,
  last_mentioned_at: null,
}));
const [alice, bob] = mockPeople;

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: () => ({ users: mockPeople, loading: false }),
}));
jest.mock('@mui/material', () => ({ Portal: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

// Bob has the page open.
const mockAwareness = {
  getStates: () =>
    new Map([[9, { user: { uid: 2 }, metadata: JSON.stringify({ user_name: 'Bob', user_uuid: bob.person_id }) }]]),
  on: jest.fn(),
  off: jest.fn(),
};
const mockUseAppAwareness = jest.fn((viewId?: string) => (viewId === 'view-1' ? mockAwareness : undefined));

jest.mock('@/components/app/app.hooks', () => ({
  useAppAwareness: (viewId?: string) => mockUseAppAwareness(viewId),
}));

const submitPendingComment = jest.fn().mockResolvedValue(undefined);

jest.mock('../InlineCommentContext', () => ({
  useInlineCommentStatus: () => ({ currentUserUuid: alice.person_id, mutatingCommentIds: new Set() }),
  useInlineCommentCompose: () => ({
    cancelPendingComment: jest.fn(),
    pendingComment: {
      selection: { blockId: 'block-1', quotedText: 'selected text' },
      rect: { top: 20, right: 100, bottom: 40, left: 20 },
    },
    submitPendingComment,
    viewId: 'view-1',
  }),
}));

function type(value: string) {
  const input = screen.getByTestId<HTMLTextAreaElement>('inline-comment-input');

  fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
  return input;
}

const options = () => screen.queryAllByRole('option').map((option) => option.getAttribute('data-person-name'));

describe('InlineCommentComposer person mentions', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    } as unknown as typeof ResizeObserver;
  });
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => window.localStorage.clear());

  it('opens the picker on @ and submits the inserted person as a mention token', () => {
    render(<InlineCommentComposer />);
    const input = type('Please check @Bo');

    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(options()).toEqual(['Bob']);
    fireEvent.click(screen.getByRole('option', { name: /Bob/ }));
    expect(input.value).toBe('Please check @Bob ');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submitPendingComment).toHaveBeenCalledWith(`Please check @[Bob](${bob.person_id}) `);
  });

  it('ranks who is on the page first and the commenter last, once ranked', () => {
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'ranked');
    render(<InlineCommentComposer />);
    type('@');

    expect(options()).toEqual(['Bob', 'Cy', 'Alice']);
    expect(mockUseAppAwareness).toHaveBeenCalledWith('view-1');
    expect(mockAwareness.on).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
