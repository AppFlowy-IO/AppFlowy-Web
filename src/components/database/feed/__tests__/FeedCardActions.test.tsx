import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useToggleRowReactionDispatch } from '@/application/database-yjs';
import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch';

import { FeedCardActions } from '../FeedCardActions';
import { useFeedMembers } from '../FeedMembersContext';

import type { ReactNode } from 'react';

jest.mock('@/application/database-yjs', () => ({ useToggleRowReactionDispatch: jest.fn() }));
jest.mock('@/application/database-yjs/dispatch', () => ({ useDuplicateRowDispatch: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../FeedMembersContext', () => ({ useFeedMembers: jest.fn() }));
jest.mock('@/components/database/components/database-row/DeleteRowConfirm', () => ({
  DeleteRowConfirm: ({ rowIds }: { rowIds: string[] }) => (
    <div data-testid='delete-row-confirm'>{rowIds.join(',')}</div>
  ),
}));
jest.mock('@/components/_shared/emoji-picker', () => ({
  EmojiPicker: ({ onEmojiSelect }: { onEmojiSelect: (emoji: string) => void }) => (
    <button data-testid='emoji-picker' onClick={() => onEmojiSelect('🎉')} type='button' />
  ),
}));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const mockUseToggleRowReactionDispatch = useToggleRowReactionDispatch as jest.MockedFunction<
  typeof useToggleRowReactionDispatch
>;
const mockUseDuplicateRowDispatch = useDuplicateRowDispatch as jest.MockedFunction<typeof useDuplicateRowDispatch>;
const mockUseFeedMembers = useFeedMembers as jest.MockedFunction<typeof useFeedMembers>;

describe('FeedCardActions', () => {
  const duplicateRow = jest.fn();
  const toggleReaction = jest.fn();

  beforeAll(() => {
    global.ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    };
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    duplicateRow.mockResolvedValue(undefined);
    mockUseDuplicateRowDispatch.mockReturnValue(duplicateRow);
    mockUseToggleRowReactionDispatch.mockReturnValue(toggleReaction);
    mockUseFeedMembers.mockReturnValue({
      resolveMember: () => undefined,
      currentUser: undefined,
      currentUid: '42',
      currentCommentAuthorId: 'uuid',
      canComment: true,
    });
  });

  it('renders nothing when the card is readonly and commenting is not allowed', () => {
    mockUseFeedMembers.mockReturnValue({
      resolveMember: () => undefined,
      currentUser: undefined,
      currentUid: null,
      currentCommentAuthorId: '',
      canComment: false,
    });
    const { container } = render(<FeedCardActions editable={false} rowId='row-1' />);

    expect(container.firstChild).toBeNull();
  });

  it('hides the more menu in readonly mode but keeps the reaction button when commenting is allowed', async () => {
    render(<FeedCardActions editable={false} rowId='row-1' />);

    expect(screen.getByTestId('feed-card-reaction-button-row-1')).toBeTruthy();
    expect(screen.queryByTestId('feed-card-more-row-1')).toBeNull();

    fireEvent.click(screen.getByTestId('feed-card-reaction-button-row-1'));
    fireEvent.click(await screen.findByTestId('emoji-picker'));
    await waitFor(() => expect(toggleReaction).toHaveBeenCalledWith('🎉', '42'));
  });

  it('duplicates and deletes from the more menu', async () => {
    render(<FeedCardActions editable rowId='row-1' />);

    fireEvent.keyDown(screen.getByTestId('feed-card-more-row-1'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByTestId('feed-row-duplicate'));
    expect(duplicateRow).toHaveBeenCalledWith('row-1');

    expect(screen.queryByTestId('delete-row-confirm')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('feed-card-more-row-1'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByTestId('feed-row-delete'));
    expect(screen.getByTestId('delete-row-confirm').textContent).toBe('row-1');
  });

  it('releases the card click guard when the menu closes or unmounts', async () => {
    const onOpenChange = jest.fn();
    const { unmount } = render(<FeedCardActions editable onOpenChange={onOpenChange} rowId='row-1' />);

    fireEvent.keyDown(screen.getByTestId('feed-card-more-row-1'), { key: 'ArrowDown' });
    const menu = await screen.findByTestId('feed-row-action-menu');

    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(false));
    fireEvent.keyDown(screen.getByTestId('feed-card-more-row-1'), { key: 'ArrowDown' });
    await screen.findByTestId('feed-row-action-menu');
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it.each([true, false])('releases the card when edit access is revoked (canComment=%s)', async (canComment) => {
    mockUseFeedMembers.mockReturnValue({ ...mockUseFeedMembers(), canComment });
    const onOpenChange = jest.fn();
    const { rerender } = render(<FeedCardActions editable onOpenChange={onOpenChange} rowId='row-1' />);

    fireEvent.keyDown(screen.getByTestId('feed-card-more-row-1'), { key: 'ArrowDown' });
    await screen.findByTestId('feed-row-action-menu');
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    rerender(<FeedCardActions editable={false} onOpenChange={onOpenChange} rowId='row-1' />);
    expect(screen.queryByTestId('feed-row-action-menu')).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    rerender(<FeedCardActions editable onOpenChange={onOpenChange} rowId='row-1' />);
    expect(screen.queryByTestId('feed-row-action-menu')).toBeNull();
  });

  it('closes the reaction picker and releases the card when commenting is revoked', async () => {
    const onOpenChange = jest.fn();
    const { rerender } = render(<FeedCardActions editable onOpenChange={onOpenChange} rowId='row-1' />);

    fireEvent.click(screen.getByTestId('feed-card-reaction-button-row-1'));
    await screen.findByTestId('emoji-picker');
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    mockUseFeedMembers.mockReturnValue({ ...mockUseFeedMembers(), canComment: false });
    rerender(<FeedCardActions editable onOpenChange={onOpenChange} rowId='row-1' />);
    expect(screen.queryByTestId('emoji-picker')).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    mockUseFeedMembers.mockReturnValue({ ...mockUseFeedMembers(), canComment: true });
    rerender(<FeedCardActions editable onOpenChange={onOpenChange} rowId='row-1' />);
    expect(screen.queryByTestId('emoji-picker')).toBeNull();
  });
});
