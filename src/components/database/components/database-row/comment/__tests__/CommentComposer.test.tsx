import { act, fireEvent, render, screen } from '@testing-library/react';

import { COMMENT_MENTION_RANKING_OVERRIDE_KEY } from '@/application/comment-mention-ranking';
import { useDatabaseContext } from '@/application/database-yjs';
import { MentionablePerson, MentionPersonRole } from '@/application/types';

import { CommentComposer } from '../CommentComposer';
import { CommentDraftContext } from '../CommentDraftContext';

jest.mock('@/application/database-yjs', () => ({ useDatabaseContext: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;

function composer(id: string) {
  return (
    <CommentComposer
      key={id}
      initiallyExpanded
      placeholder={id}
      onSubmit={() => undefined}
      testIds={{ collapsed: `collapsed-${id}`, input: `input-${id}`, submit: `submit-${id}`, attachment: `attachment-${id}` }}
    />
  );
}

describe('CommentComposer draft retention signal', () => {
  beforeEach(() => {
    mockUseDatabaseContext.mockReturnValue({} as ReturnType<typeof useDatabaseContext>);
  });

  it('tracks independent drafts and removes an unmounted composer without treating focus as a draft', () => {
    const drafts = new Set<string>();
    const notifyDraft = (id: string, hasDraft: boolean) => {
      if (hasDraft) drafts.add(id);
      else drafts.delete(id);
    };

    const { rerender } = render(
      <CommentDraftContext.Provider value={notifyDraft}>
        {composer('first')}
        {composer('second')}
      </CommentDraftContext.Provider>
    );

    expect(drafts.size).toBe(0);
    fireEvent.click(screen.getByTestId('collapsed-first'));
    fireEvent.change(screen.getByTestId('input-first'), { target: { value: ' ' } });
    expect(drafts.size).toBe(1);
    fireEvent.click(screen.getByTestId('collapsed-second'));
    fireEvent.change(screen.getByTestId('input-second'), { target: { value: 'Another thread' } });
    expect(drafts.size).toBe(2);
    fireEvent.change(screen.getByTestId('input-first'), { target: { value: '' } });
    expect(drafts.size).toBe(1);

    rerender(<CommentDraftContext.Provider value={notifyDraft}>{composer('first')}</CommentDraftContext.Provider>);
    expect(drafts.size).toBe(0);
  });

  it('retains an attachment-only draft through upload and clears the signal after the attachment is removed', async () => {
    let finishUpload!: (url: string) => void;
    const uploadFile = jest.fn(() => new Promise<string>((resolve) => { finishUpload = resolve; }));
    const notifyDraft = jest.fn();

    mockUseDatabaseContext.mockReturnValue({ uploadFile } as unknown as ReturnType<typeof useDatabaseContext>);
    const { unmount } = render(
      <CommentDraftContext.Provider value={notifyDraft}>{composer('attachment')}</CommentDraftContext.Provider>
    );

    expect(notifyDraft).toHaveBeenLastCalledWith(expect.any(String), false);
    fireEvent.change(screen.getByTestId('attachment-attachment'), {
      target: { files: [new File(['feedback'], 'feedback.txt', { type: 'text/plain' })] },
    });
    expect(notifyDraft).toHaveBeenLastCalledWith(expect.any(String), true);
    await act(async () => finishUpload('https://example.com/feedback.txt'));
    expect(screen.getByTestId('comment-pending-attachment')).toBeTruthy();
    expect(notifyDraft).toHaveBeenLastCalledWith(expect.any(String), true);
    fireEvent.click(screen.getByRole('button', { name: 'button.remove feedback.txt' }));
    expect(notifyDraft).toHaveBeenLastCalledWith(expect.any(String), false);
    unmount();
    expect(notifyDraft).toHaveBeenLastCalledWith(expect.any(String), false);
  });
});

describe('CommentComposer inline variant', () => {
  const testIds = { collapsed: 'collapsed', input: 'input', submit: 'submit', attachment: 'attachment' };

  beforeEach(() => {
    mockUseDatabaseContext.mockReturnValue({ uploadFile: jest.fn() } as unknown as ReturnType<
      typeof useDatabaseContext
    >);
  });

  it('renders the Feed field borderless with its actions on the input line', () => {
    const onSubmit = jest.fn(() => 'comment-id');

    render(<CommentComposer onSubmit={onSubmit} placeholder='Comment' testIds={testIds} variant='inline' />);

    expect(screen.getByTestId('collapsed').className).not.toContain('border');
    fireEvent.click(screen.getByTestId('collapsed'));

    const input = screen.getByTestId('input');
    const submit = screen.getByTestId('submit');

    const inputLine = submit.parentElement?.parentElement;

    expect(inputLine?.className).toContain('items-end');
    expect(inputLine?.contains(input)).toBe(true);
    expect(input.closest('.border')).toBeNull();
    expect(submit.className).toContain('text-icon-tertiary');

    fireEvent.change(input, { target: { value: 'Ship it' } });
    expect(submit.className).toContain('text-fill-theme-thick');
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith('Ship it', []);
  });

  it('keeps the boxed row-detail field by default', () => {
    render(<CommentComposer initiallyExpanded onSubmit={() => undefined} placeholder='Comment' testIds={testIds} />);

    expect(screen.getByTestId('input').closest('.border')).not.toBeNull();
  });
});

describe('CommentComposer person mentions', () => {
  const testIds = { collapsed: 'collapsed', input: 'input', submit: 'submit', attachment: 'attachment' };
  const member = (uid: number, name: string): MentionablePerson => ({
    uid,
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
  });
  const joan = member(1, 'Joan Diaz');
  const brian = member(2, 'Brian Li');
  const anna = member(3, 'Anna Kim');
  // Roster order: today's picker lists Joan first for '@an'.
  const members = [joan, brian, anna];

  beforeEach(() => {
    mockUseDatabaseContext.mockReturnValue({ uploadFile: jest.fn() } as unknown as ReturnType<
      typeof useDatabaseContext
    >);
  });
  afterEach(() => window.localStorage.clear());

  function renderComposer(props: Partial<Parameters<typeof CommentComposer>[0]> = {}) {
    const onSubmit = jest.fn(() => 'comment-id');

    render(
      <CommentComposer
        initiallyExpanded
        members={members}
        onSubmit={onSubmit}
        placeholder='Comment'
        testIds={testIds}
        {...props}
      />
    );
    return { onSubmit, input: screen.getByTestId<HTMLTextAreaElement>('input') };
  }

  const type = (input: HTMLTextAreaElement, value: string) =>
    fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
  const options = () => screen.queryAllByRole('option').map((option) => option.textContent);
  const selected = () => screen.getAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true');

  it("keeps today's roster order by default, domain matches included", () => {
    const { input } = renderComposer({ mentionParticipantIds: [brian.person_id] });

    type(input, '@an');
    expect(options()).toEqual(['Joan Diaz', 'Brian Li', 'Anna Kim']);
    type(input, '@flow');
    expect(options()).toEqual(['Joan Diaz', 'Brian Li', 'Anna Kim']);
  });

  it("ranks '@an' Anna above Joan and matches no one by domain once ranked", () => {
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'ranked');
    const { input } = renderComposer();

    type(input, '@an');
    expect(options()).toEqual(['Anna Kim', 'Brian Li', 'Joan Diaz']);
    type(input, '@flow');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('lists a thread participant first within its class and keeps arrow and Enter selection', () => {
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'ranked');
    const { input, onSubmit } = renderComposer({ mentionParticipantIds: [joan.person_id] });

    type(input, '@an');
    expect(options()).toEqual(['Anna Kim', 'Joan Diaz', 'Brian Li']);
    expect(selected()?.textContent).toBe('Anna Kim');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(selected()?.textContent).toBe('Brian Li');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selected()?.textContent).toBe('Joan Diaz');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('@Joan Diaz ');
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith(`@[Joan Diaz](${joan.person_id})`, []);
  });

  it('lists the commenter last', () => {
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'ranked');
    const { input } = renderComposer({ mentionRequesterId: String(anna.uid) });

    type(input, '@');
    expect(options()).toEqual(['Brian Li', 'Joan Diaz', 'Anna Kim']);
  });
});
