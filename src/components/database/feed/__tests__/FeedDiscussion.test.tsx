import { act, fireEvent, isInaccessible, render, screen, waitFor, within } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { addComment, addCommentReaction, deleteComment, getRowComments, resolveComment } from '@/application/database-yjs/row_comment';
import { User, YDoc, YjsEditorKey } from '@/application/types';
import { AFConfigContext } from '@/components/main/app.hooks';

import { FeedCommentSection } from '../FeedCommentSection';
import { FeedMembersProvider } from '../FeedMembersContext';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));
jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  ...jest.requireActual('@/components/database/components/cell/person/useMentionableUsers'),
  useMentionableUsersWithAutoFetch: () => ({
    users: [{ person_id: 'mention-person', name: 'Mention Person', email: 'mention@example.com' }],
  }),
}));
jest.mock('@/components/_shared/emoji-picker', () => ({ EmojiPicker: () => null }));
jest.mock('@/components/ui/textarea-autosize', () => {
  const React = jest.requireActual<typeof import('react')>('react');

  return {
    TextareaAutosize: React.forwardRef<
      HTMLTextAreaElement,
      React.TextareaHTMLAttributes<HTMLTextAreaElement> & { maxRows?: number; minRows?: number; variant?: string }
    >(function MockTextarea({ maxRows: _maxRows, minRows: _minRows, variant: _variant, ...props }, ref) {
      return <textarea ref={ref} {...props} />;
    }),
  };
});

function setup({ readOnly = false, canComment, anonymous = false }: {
  readOnly?: boolean;
  canComment?: boolean;
  anonymous?: boolean;
} = {}) {
  const rowDoc = new Y.Doc() as YDoc;
  const parentId = addComment(rowDoc, 'First discussion', 'other');
  const onNavigate = jest.fn();
  const uploadFile = jest.fn<Promise<string>, [File]>();
  const context = {
    readOnly,
    canComment,
    rowMap: { row: rowDoc },
    workspaceId: '',
    activeViewId: 'feed',
    databasePageId: 'database',
    uploadFile,
  } as unknown as DatabaseContextState;
  const content = (visible: boolean) => (
    <DatabaseContext.Provider value={context}>
      <FeedMembersProvider>
        <div data-testid='feed-card' hidden={!visible} onClick={onNavigate}>
          <FeedCommentSection rowId='row' visible={visible} />
        </div>
      </FeedMembersProvider>
    </DatabaseContext.Provider>
  );

  const renderContent = (visible: boolean) => anonymous ? content(visible) : (
    <AFConfigContext.Provider value={{
      currentUser: { uuid: 'me', uid: '42', name: 'Me' } as User,
      isAuthenticated: true,
      updateCurrentUser: async () => undefined,
      openLoginModal: () => undefined,
    }}>
      {content(visible)}
    </AFConfigContext.Provider>
  );
  const { rerender } = render(renderContent(true));

  return { rowDoc, parentId, onNavigate, uploadFile, setVisible: (visible: boolean) => rerender(renderContent(visible)) };
}

describe('in-feed discussions', () => {
  it('dismisses nested comment action portals when their retained card is hidden', async () => {
    const { setVisible } = setup();

    fireEvent.click(screen.getByTestId('feed-comment-summary-row'));
    fireEvent.click(await screen.findByTestId('row-comment-emoji-button'));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    setVisible(false);
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));
    setVisible(true);
    fireEvent.click(screen.getByTestId('feed-comment-summary-row'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('closes a hidden retained card discussion and restores its draft and upload only when reopened', async () => {
    const { rowDoc, parentId, uploadFile, setVisible } = setup();
    let finishUpload!: (url: string) => void;

    uploadFile.mockImplementation(() => new Promise((resolve) => { finishUpload = resolve; }));
    fireEvent.click(screen.getByTestId('feed-comment-summary-row'));
    fireEvent.click(await screen.findByTestId(`row-comment-reply-${parentId}`));
    const input = screen.getByTestId<HTMLTextAreaElement>('row-comment-input');

    fireEvent.change(input, { target: { value: 'Keep the remote-filtered draft' } });
    fireEvent.change(screen.getByTestId('row-comment-attachment-input'), {
      target: { files: [new File(['attachment'], 'draft.txt', { type: 'text/plain' })] },
    });
    setVisible(false);
    expect(isInaccessible(screen.getByTestId('feed-card'))).toBe(true);
    await waitFor(() => expect(isInaccessible(screen.getByTestId('feed-discussion-row'))).toBe(true));
    expect(screen.getByTestId('row-comment-input')).toBe(input);
    expect(input.value).toBe('Keep the remote-filtered draft');

    await act(async () => finishUpload('https://example.com/draft.txt'));
    setVisible(true);
    const summary = screen.getByTestId('feed-comment-summary-row');

    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(isInaccessible(screen.getByTestId('feed-discussion-row'))).toBe(true);
    fireEvent.click(summary);
    expect(isInaccessible(input)).toBe(false);
    expect(screen.getByTestId('row-comment-input')).toBe(input);
    expect(input.value).toBe('Keep the remote-filtered draft');
    expect(screen.getByTestId('comment-pending-attachment').textContent).toContain('draft.txt');
    fireEvent.click(screen.getByTestId('row-comment-send-button'));
    expect(getRowComments(rowDoc)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parentCommentId: parentId,
        content: 'Keep the remote-filtered draft',
        attachments: [expect.objectContaining({ name: 'draft.txt' })],
      }),
    ]));
  });

  it('opens existing comments, streams replies and keeps a composer available without navigating', async () => {
    const { rowDoc, parentId, onNavigate } = setup();
    const summary = screen.getByTestId('feed-comment-summary-row');

    expect(screen.queryByTestId('row-comment-section')).toBeNull();
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(summary);
    expect(await screen.findByText('First discussion')).toBeTruthy();
    expect(summary.getAttribute('aria-expanded')).toBe('true');

    act(() => { addComment(rowDoc, 'Remote reply', 'other', parentId); });
    expect(screen.getByText('Remote reply')).toBeTruthy();
    const composer = within(screen.getByTestId('row-comment-root-composer'));

    fireEvent.click(composer.getByTestId('row-comment-collapsed-input'));
    fireEvent.change(composer.getByTestId('row-comment-input'), { target: { value: 'Another discussion' } });
    fireEvent.click(composer.getByTestId('row-comment-send-button'));
    expect(screen.getByText('Another discussion')).toBeTruthy();
    expect(composer.getByTestId('row-comment-collapsed-input')).toBeTruthy();
    expect(getRowComments(rowDoc)).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'Another discussion', authorId: 'me', parentCommentId: null }),
    ]));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('preserves a reply and its pending upload across collapse and submits it to the same thread', async () => {
    const { rowDoc, parentId, uploadFile, onNavigate } = setup();
    let finishUpload!: (url: string) => void;

    uploadFile.mockImplementation(() => new Promise((resolve) => { finishUpload = resolve; }));
    const summary = screen.getByTestId('feed-comment-summary-row');

    fireEvent.click(summary);
    fireEvent.click(await screen.findByTestId(`row-comment-reply-${parentId}`));
    const input = screen.getByTestId<HTMLTextAreaElement>('row-comment-input');

    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'Reply draft' } });
    fireEvent.change(screen.getByTestId('row-comment-attachment-input'), {
      target: { files: [new File(['draft'], 'reply.txt', { type: 'text/plain' })] },
    });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(isInaccessible(input)).toBe(true));
    await act(async () => finishUpload('https://example.com/reply.txt'));
    fireEvent.click(summary);
    expect(screen.getByTestId('row-comment-input')).toBe(input);
    expect(input.value).toBe('Reply draft');
    expect(screen.getByTestId('comment-pending-attachment').textContent).toContain('reply.txt');
    fireEvent.click(screen.getByTestId('row-comment-send-button'));
    expect(getRowComments(rowDoc)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: 'Reply draft',
        parentCommentId: parentId,
        attachments: [expect.objectContaining({ name: 'reply.txt', url: 'https://example.com/reply.txt' })],
      }),
    ]));
    expect(screen.getByText('Reply draft')).toBeTruthy();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('preserves separate reply drafts when switching threads during an upload', async () => {
    const { rowDoc, parentId, uploadFile } = setup();
    let secondParentId = '';
    let finishUpload!: (url: string) => void;

    act(() => { secondParentId = addComment(rowDoc, 'Second discussion', 'other'); });
    uploadFile.mockImplementation(() => new Promise((resolve) => { finishUpload = resolve; }));
    fireEvent.click(screen.getByTestId('feed-comment-summary-row'));
    const firstReply = await screen.findByTestId(`row-comment-reply-${parentId}`);
    const first = within(firstReply.closest<HTMLElement>('[data-testid="row-comment-item"]')!);
    const secondReply = screen.getByTestId(`row-comment-reply-${secondParentId}`);
    const second = within(secondReply.closest<HTMLElement>('[data-testid="row-comment-item"]')!);

    fireEvent.click(firstReply);
    const firstInput = first.getByTestId<HTMLTextAreaElement>('row-comment-input');

    fireEvent.change(firstInput, { target: { value: '@', selectionStart: 1 } });
    fireEvent.click(first.getByRole('option', { name: 'Mention Person' }));
    fireEvent.change(first.getByTestId('row-comment-attachment-input'), {
      target: { files: [new File(['first draft'], 'first.txt', { type: 'text/plain' })] },
    });
    fireEvent.click(secondReply);
    const secondInput = second.getByTestId<HTMLTextAreaElement>('row-comment-input');

    expect(document.activeElement).toBe(secondInput);
    expect(first.getByTestId('row-comment-input')).toBe(firstInput);
    expect(firstInput.closest('[hidden]')).not.toBeNull();
    fireEvent.change(secondInput, { target: { value: 'Second draft' } });
    await act(async () => finishUpload('https://example.com/first.txt'));
    expect(document.activeElement).toBe(secondInput);
    fireEvent.click(first.getByTestId(`row-comment-reply-${parentId}`));
    expect(document.activeElement).toBe(firstInput);
    expect(firstInput.value).toBe('@Mention Person ');
    expect(first.getByTestId('comment-pending-attachment').textContent).toContain('first.txt');
    fireEvent.click(first.getByTestId('row-comment-send-button'));
    fireEvent.click(second.getByTestId(`row-comment-reply-${secondParentId}`));
    expect(second.getByTestId('row-comment-input')).toBe(secondInput);
    expect(document.activeElement).toBe(secondInput);
    expect(secondInput.value).toBe('Second draft');
    fireEvent.click(second.getByTestId('row-comment-send-button'));
    expect(getRowComments(rowDoc)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: '@[Mention Person](mention-person)',
        parentCommentId: parentId,
        attachments: [expect.objectContaining({ name: 'first.txt', url: 'https://example.com/first.txt' })],
      }),
      expect.objectContaining({ content: 'Second draft', parentCommentId: secondParentId, attachments: [] }),
    ]));
    fireEvent.click(first.getByTestId(`row-comment-reply-${parentId}`));
    expect(first.getByTestId<HTMLTextAreaElement>('row-comment-input').value).toBe('');
    expect(first.queryByTestId('comment-pending-attachment')).toBeNull();
  });

  it('resolves and reopens each parent independently while resolved discussions remain visible', async () => {
    const { rowDoc, parentId } = setup();
    let secondParentId = '';

    act(() => {
      secondParentId = addComment(rowDoc, 'Second discussion', 'other');
      addComment(rowDoc, 'Second thread reply', 'other', secondParentId);
    });
    fireEvent.click(screen.getByTestId('feed-comment-summary-row'));
    const first = within((await screen.findByText('First discussion'))
      .closest<HTMLElement>('[data-testid="row-comment-item"]')!);
    const second = within(screen.getByText('Second discussion')
      .closest<HTMLElement>('[data-testid="row-comment-item"]')!);
    const child = within(screen.getByText('Second thread reply')
      .closest<HTMLElement>('[data-testid="row-comment-item"]')!);

    expect(child.queryByTestId('row-comment-resolve-button')).toBeNull();
    fireEvent.click(first.getByTestId('row-comment-resolve-button'));
    expect(first.getByText('rowComment.resolved')).toBeTruthy();
    fireEvent.click(second.getByTestId('row-comment-resolve-button'));
    expect(second.getByText('rowComment.resolved')).toBeTruthy();
    expect(getRowComments(rowDoc).filter((comment) => !comment.parentCommentId))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: parentId, isResolved: true }),
        expect.objectContaining({ id: secondParentId, isResolved: true }),
      ]));
    fireEvent.click(second.getByTestId('row-comment-resolve-button'));
    expect(second.queryByText('rowComment.resolved')).toBeNull();
    expect(second.getByTestId(`row-comment-reply-${secondParentId}`)).toBeTruthy();
    expect(getRowComments(rowDoc).find((comment) => comment.id === parentId)?.isResolved).toBe(true);
    expect(getRowComments(rowDoc).find((comment) => comment.id === secondParentId)?.isResolved).toBe(false);
    expect(child.getByText('Second thread reply')).toBeTruthy();
  });

  it('dismisses without clearing the active draft when another thread retains hidden mention suggestions', async () => {
    const { rowDoc, parentId } = setup();
    let secondParentId = '';

    act(() => { secondParentId = addComment(rowDoc, 'Second discussion', 'other'); });
    const summary = screen.getByTestId('feed-comment-summary-row');

    fireEvent.click(summary);
    fireEvent.click(await screen.findByTestId(`row-comment-reply-${parentId}`));
    const first = within(screen.getByTestId(`row-comment-reply-composer-${parentId}`));
    const firstInput = first.getByTestId<HTMLTextAreaElement>('row-comment-input');

    fireEvent.change(firstInput, { target: { value: '@', selectionStart: 1 } });
    expect(first.getByRole('listbox')).toBeTruthy();
    fireEvent.click(screen.getByTestId(`row-comment-reply-${secondParentId}`));
    expect(first.getByRole('listbox', { hidden: true })).toBeTruthy();
    const second = within(screen.getByTestId(`row-comment-reply-composer-${secondParentId}`));
    const secondInput = second.getByTestId<HTMLTextAreaElement>('row-comment-input');

    fireEvent.change(secondInput, { target: { value: 'Keep this draft' } });
    fireEvent.keyDown(secondInput, { key: 'Escape' });
    await waitFor(() => expect(isInaccessible(secondInput)).toBe(true));
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(summary);
    expect(second.getByTestId('row-comment-input')).toBe(secondInput);
    expect(secondInput.value).toBe('Keep this draft');
    fireEvent.click(screen.getByTestId(`row-comment-reply-${parentId}`));
    expect(firstInput.value).toBe('@');
    expect(first.getByRole('listbox')).toBeTruthy();
  });

  it.each([{ anonymous: true }, { anonymous: false }])(
    'allows read-only discussion viewing without mutation or authentication ($anonymous)',
    async ({ anonymous }) => {
      const { rowDoc, parentId } = setup({ readOnly: true, anonymous });

      act(() => {
        resolveComment(rowDoc, parentId, true, 'other');
        addCommentReaction(rowDoc, parentId, '👍', 'other');
      });
      const before = Y.encodeStateAsUpdate(rowDoc);

      fireEvent.click(screen.getByTestId('feed-comment-summary-row'));
      expect(await screen.findByText('First discussion')).toBeTruthy();
      expect(screen.getByText('rowComment.resolved')).toBeTruthy();
      expect(screen.queryByTestId('feed-add-comment-row')).toBeNull();
      expect(screen.queryByTestId(`row-comment-reply-${parentId}`)).toBeNull();
      expect(screen.queryByTestId('row-comment-actions')).toBeNull();
      expect(screen.getByTestId<HTMLButtonElement>('row-comment-reaction-👍').disabled).toBe(true);
      expect(Y.encodeStateAsUpdate(rowDoc)).toEqual(before);
    }
  );

  it('permits replies with read-and-comment access and recovers after all comments are removed', async () => {
    const { rowDoc, parentId } = setup({ readOnly: true, canComment: true });
    const summary = screen.getByTestId('feed-comment-summary-row');

    fireEvent.click(summary);
    expect(await screen.findByTestId(`row-comment-reply-${parentId}`)).toBeTruthy();
    act(() => { deleteComment(rowDoc, parentId); });
    expect(summary.textContent).toContain('globalComment.replies:0');
    fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    act(() => { addComment(rowDoc, 'New remote discussion', 'other'); });
    fireEvent.click(summary);
    expect(screen.getByText('New remote discussion')).toBeTruthy();
    expect(screen.getByTestId('row-comment-root-composer')).toBeTruthy();
    expect(rowDoc.getMap(YjsEditorKey.data_section).has(YjsEditorKey.comment)).toBe(true);
  });
});
