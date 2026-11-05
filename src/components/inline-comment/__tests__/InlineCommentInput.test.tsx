import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { serializeCommentMentions } from '@/application/comment-mentions';
import { MentionablePerson, MentionPersonRole } from '@/application/types';

import { CommentDraft, EMPTY_COMMENT_DRAFT, InlineCommentInput } from '../InlineCommentInput';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const mockFetch = jest.fn();
const people: MentionablePerson[] = ['Alice', 'Bob'].map((name, index) => ({
  person_id: `00000000-0000-4000-8000-00000000000${index + 1}`,
  uid: index + 1,
  name,
  email: `${name.toLowerCase()}@example.com`,
  role: MentionPersonRole.Member,
  avatar_url: null,
  cover_image_url: null,
  custom_image_url: null,
  description: null,
  invited: false,
  last_mentioned_at: null,
}));

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: (open: boolean) => {
    mockFetch(open);
    return { users: people, loading: false };
  },
}));

function Harness({
  submit,
  cancel,
  initial = EMPTY_COMMENT_DRAFT,
}: {
  submit: (content: string) => void;
  cancel?: () => void;
  initial?: CommentDraft;
}) {
  const [draft, setDraft] = useState(initial);

  return (
    <>
      <InlineCommentInput
        data-testid='input'
        draft={draft}
        onDraftChange={setDraft}
        placeholder='Comment'
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) submit(serializeCommentMentions(draft.content, draft.mentions));
          if (event.key === 'Escape') cancel?.();
        }}
      />
      <button onClick={() => submit(serializeCommentMentions(draft.content, draft.mentions))}>Send</button>
    </>
  );
}

function type(value: string, caret = value.length) {
  const input = screen.getByTestId('input');

  fireEvent.change(input, { target: { value, selectionStart: caret, selectionEnd: caret } });
  return input;
}

describe('inline comment person mentions', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    } as unknown as typeof ResizeObserver;
  });

  it('selects by mouse and serializes only the selected label', () => {
    const submit = jest.fn();

    render(<Harness submit={submit} />);
    expect(mockFetch).toHaveBeenLastCalledWith(false);
    type('@Ali');
    expect(mockFetch).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('option', { name: /Alice/ }));
    expect(screen.getByTestId('input').getAttribute('aria-expanded')).toBe('false');
    type('@Alice and @Alice');
    fireEvent.click(screen.getByText('Send'));
    expect(submit).toHaveBeenCalledWith(`@[Alice](${people[0].person_id}) and @Alice`);
  });

  it('moves the active option with arrows and selects on Enter without submitting', () => {
    const submit = jest.fn();

    render(<Harness submit={submit} />);
    const input = type('@');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Bob/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe('@Bob ');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submit).toHaveBeenCalledWith(`@[Bob](${people[1].person_id}) `);
  });

  it('dismisses suggestions with Escape before cancelling the comment', () => {
    const cancel = jest.fn();

    render(<Harness submit={jest.fn()} cancel={cancel} />);
    const input = type('@');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(cancel).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps IME Enter and Shift+Enter out of selection and submission', () => {
    const submit = jest.fn();

    render(<Harness submit={submit} />);
    const input = type('@');

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(submit).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe('@');
  });

  it('inserts at the caret and preserves the suffix', () => {
    const submit = jest.fn();

    render(<Harness submit={submit} />);
    type('Hi @Al please review', 6);
    fireEvent.click(screen.getByRole('option', { name: /Alice/ }));
    expect(screen.getByTestId('input').value).toBe('Hi @Alice  please review');
    fireEvent.click(screen.getByText('Send'));
    expect(submit).toHaveBeenCalledWith(`Hi @[Alice](${people[0].person_id})  please review`);
  });

  it('drops a selected person when their label is edited', () => {
    const submit = jest.fn();

    render(<Harness submit={submit} />);
    type('@Ali');
    fireEvent.click(screen.getByRole('option', { name: /Alice/ }));
    type('@Alina ');
    fireEvent.click(screen.getByText('Send'));
    expect(submit).toHaveBeenCalledWith('@Alina ');
  });

  it('leaves unmatched queries and email addresses as ordinary text', () => {
    const submit = jest.fn();

    render(<Harness submit={submit} />);
    const input = type('@nobody-matches');

    expect(screen.getByRole('status').textContent).toBe('findAndReplace.noResult');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fireEvent.keyDown(input, { key: 'Escape' });
    type('alice@example.com');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByText('Send'));
    expect(submit).toHaveBeenCalledWith('alice@example.com');
  });

  it('searches by full email and uses the most recent standalone trigger', () => {
    render(<Harness submit={jest.fn()} />);
    type('@alice@example.com');
    expect(screen.getByRole('option', { name: /Alice/ })).not.toBeNull();
    type('@nobody and @bob@example.com');
    expect(screen.queryAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: /Bob/ })).not.toBeNull();
  });
});
