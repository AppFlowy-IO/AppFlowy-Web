import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useToggleRowReactionDispatch } from '@/application/database-yjs';
import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch';

import { FeedCardActions } from '../FeedCardActions';
import { useFeedMembers } from '../FeedMembersContext';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

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
jest.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));
jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { onSelect?: () => void }) => (
    <button {...props} onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
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

    fireEvent.click(await screen.findByTestId('emoji-picker'));
    await waitFor(() => expect(toggleReaction).toHaveBeenCalledWith('🎉', '42'));
  });

  it('duplicates and deletes from the more menu', () => {
    render(<FeedCardActions editable rowId='row-1' />);

    fireEvent.click(screen.getByTestId('feed-row-duplicate'));
    expect(duplicateRow).toHaveBeenCalledWith('row-1');

    expect(screen.queryByTestId('delete-row-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('feed-row-delete'));
    expect(screen.getByTestId('delete-row-confirm').textContent).toBe('row-1');
  });

  it('reports popover state so the card can ignore clicks while a menu is open', () => {
    const onOpenChange = jest.fn();

    mockUseFeedMembers.mockReturnValue({
      resolveMember: () => undefined,
      currentUser: undefined,
      currentUid: null,
      currentCommentAuthorId: '',
      canComment: false,
    });
    render(<FeedCardActions editable onOpenChange={onOpenChange} rowId='row-1' />);

    expect(screen.queryByTestId('feed-card-reaction-button-row-1')).toBeNull();
    expect(screen.getByTestId('feed-card-more-row-1')).toBeTruthy();
  });
});
