import { fireEvent, render, screen } from '@testing-library/react';

import { useRowReactions, useToggleRowReactionDispatch } from '@/application/database-yjs';

import { useFeedMembers } from '../FeedMembersContext';
import { FeedRowReactions } from '../FeedRowReactions';

import type { ReactNode } from 'react';

jest.mock('@/application/database-yjs', () => ({
  useRowReactions: jest.fn(),
  useToggleRowReactionDispatch: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { emoji?: string }) => `${key}${options?.emoji ?? ''}` }),
}));
jest.mock('../FeedMembersContext', () => ({ useFeedMembers: jest.fn() }));
jest.mock('@/components/_shared/emoji-picker', () => ({
  EmojiPicker: ({ onEmojiSelect }: { onEmojiSelect: (emoji: string) => void }) => (
    <button data-testid='emoji-picker' onClick={() => onEmojiSelect('🚀')} type='button' />
  ),
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

const mockUseRowReactions = useRowReactions as jest.MockedFunction<typeof useRowReactions>;
const mockUseToggleRowReactionDispatch = useToggleRowReactionDispatch as jest.MockedFunction<
  typeof useToggleRowReactionDispatch
>;
const mockUseFeedMembers = useFeedMembers as jest.MockedFunction<typeof useFeedMembers>;

describe('FeedRowReactions', () => {
  const toggleReaction = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseToggleRowReactionDispatch.mockReturnValue(toggleReaction);
    mockUseRowReactions.mockReturnValue({ '👍': ['1', '42'], '🎉': ['1'] });
    mockUseFeedMembers.mockReturnValue({
      resolveMember: () => undefined,
      currentUser: undefined,
      currentUid: '42',
      currentCommentAuthorId: 'uuid',
      canComment: true,
    });
  });

  it('renders reaction chips with counts and highlights the current user reaction', () => {
    render(<FeedRowReactions rowId='row-1' />);

    expect(screen.getByTestId('feed-row-reaction-count-row-1-👍').textContent).toBe('2');
    expect(screen.getByTestId('feed-row-reaction-row-1-👍').getAttribute('data-reacted')).toBe('true');
    expect(screen.getByTestId('feed-row-reaction-row-1-🎉').getAttribute('data-reacted')).toBe('false');

    fireEvent.click(screen.getByTestId('feed-row-reaction-row-1-🎉'));
    expect(toggleReaction).toHaveBeenCalledWith('🎉', '42');
  });

  it('adds a reaction through the lazily loaded picker chip', async () => {
    render(<FeedRowReactions rowId='row-1' />);

    fireEvent.click(await screen.findByTestId('emoji-picker'));
    expect(toggleReaction).toHaveBeenCalledWith('🚀', '42');
  });

  it('shows existing reactions read-only and hides the add chip when commenting is not allowed', () => {
    mockUseFeedMembers.mockReturnValue({
      resolveMember: () => undefined,
      currentUser: undefined,
      currentUid: null,
      currentCommentAuthorId: '',
      canComment: false,
    });
    render(<FeedRowReactions rowId='row-1' />);

    expect(screen.queryByTestId('feed-row-add-reaction-row-1')).toBeNull();
    expect(screen.getByTestId<HTMLButtonElement>('feed-row-reaction-row-1-👍').disabled).toBe(true);

    fireEvent.click(screen.getByTestId('feed-row-reaction-row-1-👍'));
    expect(toggleReaction).not.toHaveBeenCalled();
  });

  it('renders nothing without reactions when the viewer cannot react', () => {
    mockUseRowReactions.mockReturnValue({});
    mockUseFeedMembers.mockReturnValue({
      resolveMember: () => undefined,
      currentUser: undefined,
      currentUid: null,
      currentCommentAuthorId: '',
      canComment: false,
    });
    const { container } = render(<FeedRowReactions rowId='row-1' />);

    expect(container.firstChild).toBeNull();
  });
});
