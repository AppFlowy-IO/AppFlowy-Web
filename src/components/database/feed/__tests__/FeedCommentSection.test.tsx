import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { useDatabaseContext, useRowMap } from '@/application/database-yjs';
import { useAddCommentDispatch } from '@/application/database-yjs/comment_dispatch';
import { addComment } from '@/application/database-yjs/row_comment';
import { YDoc, YjsEditorKey } from '@/application/types';

import { FeedCommentSection } from '../FeedCommentSection';
import { useFeedMembers } from '../FeedMembersContext';

jest.mock('@/application/database-yjs', () => ({ useRowMap: jest.fn(), useDatabaseContext: jest.fn() }));
jest.mock('@/application/database-yjs/comment_dispatch', () => ({ useAddCommentDispatch: jest.fn() }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options && options.count !== undefined ? `${key}:${options.count}` : key,
  }),
}));
jest.mock('../FeedMembersContext', () => ({ useFeedMembers: jest.fn() }));
jest.mock('../FeedAvatar', () => ({
  FeedAvatar: ({ member }: { member?: { name: string } }) => <span data-testid='feed-avatar'>{member?.name ?? ''}</span>,
}));
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

const mockUseRowMap = useRowMap as jest.MockedFunction<typeof useRowMap>;
const mockUseAddCommentDispatch = useAddCommentDispatch as jest.MockedFunction<typeof useAddCommentDispatch>;
const mockUseFeedMembers = useFeedMembers as jest.MockedFunction<typeof useFeedMembers>;

function createRowDoc(): YDoc {
  const rowDoc = new Y.Doc() as unknown as YDoc;

  rowDoc.getMap(YjsEditorKey.data_section);
  return rowDoc;
}

describe('FeedCommentSection', () => {
  const addCommentDispatch = jest.fn();
  const resolveMember = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useDatabaseContext as jest.Mock).mockReturnValue({
      uploadFile: jest.fn().mockResolvedValue('https://example.com/note.txt'),
    });
    addCommentDispatch.mockReturnValue('comment-id');
    mockUseAddCommentDispatch.mockReturnValue(addCommentDispatch);
    resolveMember.mockImplementation((id: string) =>
      id === 'person-1' ? { name: 'Bob', email: 'bob@example.com', avatarUrl: null } : undefined
    );
    mockUseFeedMembers.mockReturnValue({
      resolveMember,
      currentUser: undefined,
      currentUid: '42',
      currentCommentAuthorId: 'me',
      canComment: true,
    });
  });

  afterEach(() => jest.useRealTimers());

  it('shows the add-comment input without creating a comments map when there are no comments', () => {
    const rowDoc = createRowDoc();

    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc });
    render(<FeedCommentSection rowId='row-1' />);

    expect(screen.getByTestId('feed-add-comment-collapsed-row-1')).toBeTruthy();
    expect(rowDoc.getMap(YjsEditorKey.data_section).has(YjsEditorKey.comment)).toBe(false);
  });

  it('submits a trimmed comment as the current author and collapses again', () => {
    mockUseRowMap.mockReturnValue({ 'row-1': createRowDoc() });
    render(<FeedCommentSection rowId='row-1' />);

    fireEvent.click(screen.getByTestId('feed-add-comment-collapsed-row-1'));
    const input = screen.getByTestId('feed-add-comment-input-row-1');

    fireEvent.change(input, { target: { value: '  Nice post  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(addCommentDispatch).toHaveBeenCalledWith('Nice post', 'me', undefined, []);
    expect(screen.getByTestId('feed-add-comment-collapsed-row-1')).toBeTruthy();
  });

  it('summarizes existing comments with the latest commenter and reply count', () => {
    const rowDoc = createRowDoc();

    jest.useFakeTimers({ now: new Date('2024-06-15T10:00:00Z') });
    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc });
    addComment(rowDoc, 'first', 'someone-else');
    render(<FeedCommentSection rowId='row-1' />);

    expect(screen.getByTestId('feed-comment-count-row-1').textContent).toBe('globalComment.replies:1');

    jest.setSystemTime(new Date('2024-06-15T10:00:05Z'));
    act(() => {
      addComment(rowDoc, 'second', 'person-1');
    });
    jest.useRealTimers();

    expect(screen.getByTestId('feed-comment-count-row-1').textContent).toBe('globalComment.replies:2');
    expect(screen.getByTestId('feed-avatar').textContent).toBe('Bob');
    expect(screen.queryByTestId('feed-add-comment-row-1')).toBeNull();
  });

  it('preserves text, mentions and an in-progress upload when the first remote comment arrives', async () => {
    const rowDoc = createRowDoc();
    const personId = 'a318b9a0-6e2a-4c85-9638-16fd152af6e1';
    let finishUpload!: (url: string) => void;
    const uploadFile = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          finishUpload = resolve;
        })
    );

    (useDatabaseContext as jest.Mock).mockReturnValue({ uploadFile });
    mockUseFeedMembers.mockReturnValue({
      ...mockUseFeedMembers(),
      mentionableUsers: [
        {
          person_id: personId,
          name: 'Alice',
          email: 'alice@example.com',
          uid: '7',
          avatar_url: null,
          cover_image_url: null,
          custom_image_url: null,
          description: null,
          role: 1,
          invited: false,
          last_mentioned_at: null,
        },
      ],
    });
    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc });
    render(<FeedCommentSection rowId='row-1' />);
    fireEvent.click(screen.getByTestId('feed-add-comment-collapsed-row-1'));
    const input = screen.getByTestId<HTMLTextAreaElement>('feed-add-comment-input-row-1');

    fireEvent.change(input, { target: { value: '@' } });
    fireEvent.click(screen.getByRole('option'));
    fireEvent.change(input, { target: { value: '@Alice please review' } });
    fireEvent.change(screen.getByTestId('feed-add-comment-attachment-row-1'), {
      target: { files: [new File(['hello'], 'note.txt', { type: 'text/plain' })] },
    });
    act(() => {
      addComment(rowDoc, 'First reply', 'person-1');
    });

    expect(screen.getByTestId('feed-add-comment-input-row-1')).toBe(input);
    expect(input.value).toBe('@Alice please review');
    expect(screen.getByRole('status').textContent).toBe('fileDropzone.uploading');
    expect(screen.queryByTestId('feed-comment-summary-row-1')).toBeNull();
    await act(async () => finishUpload('https://example.com/note.txt'));
    fireEvent.blur(input);
    expect(screen.getByTestId('comment-pending-attachment').textContent).toContain('note.txt');

    addCommentDispatch.mockReturnValueOnce(undefined);
    fireEvent.click(screen.getByTestId('feed-add-comment-submit-row-1'));
    expect(screen.getByTestId('feed-add-comment-input-row-1')).toBe(input);

    fireEvent.click(screen.getByTestId('feed-add-comment-submit-row-1'));
    expect(addCommentDispatch).toHaveBeenLastCalledWith(`@[Alice](${personId}) please review`, 'me', undefined, [
      expect.objectContaining({ name: 'note.txt', url: 'https://example.com/note.txt' }),
    ]);
    expect(screen.getByTestId('feed-comment-count-row-1').textContent).toBe('globalComment.replies:1');
    expect(screen.queryByTestId('feed-add-comment-row-1')).toBeNull();
  });

  it('shows the new summary after the active draft is cancelled', () => {
    const rowDoc = createRowDoc();

    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc });
    render(<FeedCommentSection rowId='row-1' />);
    fireEvent.click(screen.getByTestId('feed-add-comment-collapsed-row-1'));
    const input = screen.getByTestId('feed-add-comment-input-row-1');

    fireEvent.change(input, { target: { value: 'Discard this draft' } });
    act(() => {
      addComment(rowDoc, 'First reply', 'person-1');
    });
    expect(screen.getByTestId('feed-add-comment-input-row-1')).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByTestId('feed-comment-count-row-1').textContent).toBe('globalComment.replies:1');
    expect(screen.queryByTestId('feed-add-comment-row-1')).toBeNull();
    expect(addCommentDispatch).not.toHaveBeenCalled();
  });

  it('shows the first remote comment immediately when the composer is inactive', () => {
    const rowDoc = createRowDoc();

    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc });
    render(<FeedCommentSection rowId='row-1' />);
    act(() => {
      addComment(rowDoc, 'First reply', 'person-1');
    });
    expect(screen.getByTestId('feed-comment-count-row-1').textContent).toBe('globalComment.replies:1');
    expect(screen.queryByTestId('feed-add-comment-row-1')).toBeNull();
  });

  it('keeps the summary visible if commenting permission is revoked during a draft', () => {
    const rowDoc = createRowDoc();

    mockUseRowMap.mockReturnValue({ 'row-1': rowDoc });
    render(<FeedCommentSection rowId='row-1' />);
    fireEvent.click(screen.getByTestId('feed-add-comment-collapsed-row-1'));
    fireEvent.change(screen.getByTestId('feed-add-comment-input-row-1'), { target: { value: 'Draft' } });
    act(() => {
      addComment(rowDoc, 'First reply', 'person-1');
    });
    mockUseFeedMembers.mockReturnValue({ ...mockUseFeedMembers(), canComment: false });
    act(() => {
      addComment(rowDoc, 'Second reply', 'person-1');
    });
    expect(screen.getByTestId('feed-comment-count-row-1').textContent).toBe('globalComment.replies:2');
    mockUseFeedMembers.mockReturnValue({ ...mockUseFeedMembers(), canComment: true });
    act(() => {
      addComment(rowDoc, 'Third reply', 'person-1');
    });
    expect(screen.getByTestId('feed-comment-count-row-1').textContent).toBe('globalComment.replies:3');
    expect(screen.queryByTestId('feed-add-comment-row-1')).toBeNull();
  });

  it('preserves the draft when the row cannot accept a comment, then submits it after hydration', () => {
    mockUseRowMap.mockReturnValue(null);
    addCommentDispatch.mockReturnValue(undefined);
    const { rerender } = render(<FeedCommentSection rowId='row-1' />);

    fireEvent.click(screen.getByTestId('feed-add-comment-collapsed-row-1'));
    const input = screen.getByTestId<HTMLTextAreaElement>('feed-add-comment-input-row-1');

    fireEvent.change(input, { target: { value: 'Keep my draft' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('Keep my draft');
    expect(document.activeElement).toBe(input);

    mockUseRowMap.mockReturnValue({ 'row-1': createRowDoc() });
    addCommentDispatch.mockReturnValue('saved-comment');
    rerender(<FeedCommentSection rowId='row-1' />);
    fireEvent.click(screen.getByTestId('feed-add-comment-submit-row-1'));

    expect(addCommentDispatch).toHaveBeenLastCalledWith('Keep my draft', 'me', undefined, []);
    expect(screen.getByTestId('feed-add-comment-collapsed-row-1')).toBeTruthy();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])('preserves IME confirmation Enter events (%j)', (composition) => {
    mockUseRowMap.mockReturnValue({ 'row-1': createRowDoc() });
    render(<FeedCommentSection rowId='row-1' />);

    fireEvent.click(screen.getByTestId('feed-add-comment-collapsed-row-1'));
    const input = screen.getByTestId<HTMLTextAreaElement>('feed-add-comment-input-row-1');

    fireEvent.change(input, { target: { value: '你好' } });
    expect(fireEvent.keyDown(input, { key: 'Enter', ...composition })).toBe(true);
    expect(addCommentDispatch).not.toHaveBeenCalled();
    expect(input.value).toBe('你好');

    fireEvent.keyDown(input, { key: 'Enter', isComposing: false, keyCode: 13 });
    expect(addCommentDispatch).toHaveBeenCalledWith('你好', 'me', undefined, []);
  });

  it('uploads an attachment and allows an attachment-only comment in the desktop wire format', async () => {
    mockUseRowMap.mockReturnValue({ 'row-1': createRowDoc() });
    render(<FeedCommentSection rowId='row-1' />);
    fireEvent.click(screen.getByTestId('feed-add-comment-collapsed-row-1'));
    fireEvent.change(screen.getByTestId('feed-add-comment-attachment-row-1'), {
      target: { files: [new File(['hello'], 'note.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => expect(screen.getByTestId('comment-pending-attachment').textContent).toContain('note.txt'));
    fireEvent.click(screen.getByTestId('feed-add-comment-submit-row-1'));
    expect(addCommentDispatch).toHaveBeenCalledWith('', 'me', undefined, [
      expect.objectContaining({
        name: 'note.txt',
        url: 'https://example.com/note.txt',
        file_type: 'text/plain',
        size: 5,
      }),
    ]);
  });

  it('keeps the caret after text typed immediately after selecting a mention', () => {
    jest.useFakeTimers();
    mockUseRowMap.mockReturnValue({ 'row-1': createRowDoc() });
    const personId = 'a318b9a0-6e2a-4c85-9638-16fd152af6e1';

    mockUseFeedMembers.mockReturnValue({
      resolveMember,
      currentUser: undefined,
      currentUid: '42',
      currentCommentAuthorId: 'me',
      canComment: true,
      mentionableUsers: [
        {
          person_id: personId,
          name: 'Alice',
          email: 'alice@example.com',
          uid: '7',
          avatar_url: null,
          cover_image_url: null,
          custom_image_url: null,
          description: null,
          role: 1,
          invited: false,
          last_mentioned_at: null,
        },
      ],
    });
    render(<FeedCommentSection rowId='row-1' />);
    fireEvent.click(screen.getByTestId('feed-add-comment-collapsed-row-1'));
    const input = screen.getByTestId<HTMLTextAreaElement>('feed-add-comment-input-row-1');

    fireEvent.change(input, { target: { value: '@' } });
    fireEvent.click(screen.getByRole('option'));
    fireEvent.change(input, { target: { value: '@Alice please review' } });
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(input.selectionStart).toBe(input.value.length);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(addCommentDispatch).toHaveBeenCalledWith(`@[Alice](${personId}) please review`, 'me', undefined, []);
  });

  it('keeps the draft and disables submission while uploading or when an upload fails', async () => {
    let rejectUpload!: (error: Error) => void;
    const uploadFile = jest.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectUpload = reject;
        })
    );

    (useDatabaseContext as jest.Mock).mockReturnValue({ uploadFile });
    mockUseRowMap.mockReturnValue({ 'row-1': createRowDoc() });
    render(<FeedCommentSection rowId='row-1' />);
    fireEvent.click(screen.getByTestId('feed-add-comment-collapsed-row-1'));
    const input = screen.getByTestId<HTMLTextAreaElement>('feed-add-comment-input-row-1');

    fireEvent.change(input, { target: { value: 'Keep attachment draft' } });
    fireEvent.change(screen.getByTestId('feed-add-comment-attachment-row-1'), {
      target: { files: [new File(['hello'], 'note.txt')] },
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(addCommentDispatch).not.toHaveBeenCalled();
    await act(async () => {
      rejectUpload(new Error('offline'));
    });
    expect(screen.getByRole('alert').textContent).toBe('grid.media.uploadError');
    expect(input.value).toBe('Keep attachment draft');
  });

  it('renders nothing when the viewer cannot comment and the row has no comments', () => {
    mockUseRowMap.mockReturnValue({ 'row-1': createRowDoc() });
    mockUseFeedMembers.mockReturnValue({
      resolveMember,
      currentUser: undefined,
      currentUid: null,
      currentCommentAuthorId: '',
      canComment: false,
    });
    const { container } = render(<FeedCommentSection rowId='row-1' />);

    expect(container.firstChild).toBeNull();
  });
});
