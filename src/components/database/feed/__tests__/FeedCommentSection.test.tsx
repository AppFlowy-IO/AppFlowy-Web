import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { useRowMap } from '@/application/database-yjs';
import { useAddCommentDispatch } from '@/application/database-yjs/comment_dispatch';
import { addComment } from '@/application/database-yjs/row_comment';
import { YDoc, YjsEditorKey } from '@/application/types';

import { FeedCommentSection } from '../FeedCommentSection';
import { useFeedMembers } from '../FeedMembersContext';

jest.mock('@/application/database-yjs', () => ({ useRowMap: jest.fn() }));
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

    expect(addCommentDispatch).toHaveBeenCalledWith('Nice post', 'me');
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

    expect(addCommentDispatch).toHaveBeenLastCalledWith('Keep my draft', 'me');
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
    expect(addCommentDispatch).toHaveBeenCalledWith('你好', 'me');
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
