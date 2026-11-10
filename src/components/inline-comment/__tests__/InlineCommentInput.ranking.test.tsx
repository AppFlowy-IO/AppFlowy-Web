import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { COMMENT_MENTION_RANKING_OVERRIDE_KEY } from '@/application/comment-mention-ranking';
import { serializeCommentMentions } from '@/application/comment-mentions';
import { MentionablePerson, MentionPersonRole } from '@/application/types';
import { CommentMentionAwareness } from '@/components/_shared/comment-mention/useCommentMentionPicker';

import { CommentDraft, EMPTY_COMMENT_DRAFT, InlineCommentInput } from '../InlineCommentInput';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const mockPeople: MentionablePerson[] = ['Ada', 'Bob', 'Cy'].map((name, index) => ({
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
const [ada, bob, cy] = mockPeople;

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: () => ({ users: mockPeople, loading: false }),
}));

/** Bob is on the page. */
const awareness = {
  getStates: () =>
    new Map([[7, { user: { uid: 2 }, metadata: JSON.stringify({ user_name: 'Bob', user_uuid: bob.person_id }) }]]),
  on: jest.fn(),
  off: jest.fn(),
} as unknown as CommentMentionAwareness;

function Harness({ submit }: { submit: (content: string) => void }) {
  const [draft, setDraft] = useState<CommentDraft>(EMPTY_COMMENT_DRAFT);

  return (
    <InlineCommentInput
      data-testid='input'
      draft={draft}
      onDraftChange={setDraft}
      placeholder='Comment'
      mentionParticipantIds={[cy.person_id]}
      mentionAwareness={awareness}
      mentionRequesterId={ada.person_id}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) submit(serializeCommentMentions(draft.content, draft.mentions));
      }}
    />
  );
}

function type(value: string) {
  const input = screen.getByTestId<HTMLTextAreaElement>('input');

  fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
  return input;
}

const options = () => screen.queryAllByRole('option').map((option) => option.getAttribute('data-person-name'));

describe('inline comment mention ranking', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    } as unknown as typeof ResizeObserver;
  });
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => window.localStorage.clear());

  it('keeps the roster order by default, whoever takes part or is present', () => {
    render(<Harness submit={jest.fn()} />);
    type('@');
    expect(options()).toEqual(['Ada', 'Bob', 'Cy']);
    expect(awareness.on).not.toHaveBeenCalled();
  });

  it('ranks the thread participant, then who is on the page, then the requester, once ranked', () => {
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'ranked');
    const submit = jest.fn();

    render(<Harness submit={submit} />);
    const input = type('@');

    expect(options()).toEqual(['Cy', 'Bob', 'Ada']);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('@Bob ');
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submit).toHaveBeenCalledWith(`@[Bob](${bob.person_id}) `);
  });

  it('still finds a full address, and no one by the shared domain, once ranked', () => {
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'ranked');
    render(<Harness submit={jest.fn()} />);

    type('@ada@appflowy.io');
    expect(options()).toEqual(['Ada']);
    type('@flow');
    expect(options()).toEqual([]);
    expect(screen.getByRole('status').textContent).toBe('findAndReplace.noResult');
  });
});
