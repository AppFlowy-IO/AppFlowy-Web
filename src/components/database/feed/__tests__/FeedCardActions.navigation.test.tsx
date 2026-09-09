import { fireEvent, render, screen } from '@testing-library/react';

import { FeedCard } from '../FeedCard';

const mockNavigateToRow = jest.fn();
const mockDeleteRows = jest.fn().mockResolvedValue(undefined);

jest.mock('@/application/database-yjs', () => ({
  useCellSelector: () => ({ data: 'Post title' }),
  useDatabaseContext: () => ({ navigateToRow: mockNavigateToRow }),
  useDatabaseViewLayout: () => 6,
  useReadOnly: () => false,
  useRowDataSelector: () => ({ row: undefined }),
  useRowMetaSelector: () => ({ cover: null, documentId: '', icon: '', isEmptyDocument: true }),
  useRowReactions: () => ({}),
  useToggleRowReactionDispatch: () => jest.fn(),
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  useDuplicateRowDispatch: () => jest.fn(),
  useTrashAwareDeleteRowsDispatch: () => mockDeleteRows,
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../FeedMembersContext', () => ({
  useFeedMembers: () => ({ resolveMember: () => undefined, canComment: true, currentUid: '42' }),
}));
jest.mock('../FeedCardProperties', () => ({ FeedCardProperties: () => null }));
jest.mock('../FeedCardCover', () => ({ FeedCardCover: () => null }));
jest.mock('../FeedCommentSection', () => ({ FeedCommentSection: () => null }));
jest.mock('../FeedDocumentPreview', () => ({ FeedDocumentPreview: () => null }));
jest.mock('../FeedRowIcon', () => ({ FeedRowIcon: () => null }));
jest.mock('@/components/_shared/emoji-picker', () => ({ EmojiPicker: () => <div data-testid='emoji-picker' /> }));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));

beforeAll(() => {
  global.ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => jest.clearAllMocks());

it('does not navigate when cancelling the real portalled delete confirmation', async () => {
  render(<FeedCard primaryFieldId='primary' rowId='row-1' />);
  fireEvent.keyDown(screen.getByTestId('feed-card-more-row-1'), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByTestId('feed-row-delete'));
  await screen.findByRole('dialog');
  expect(mockNavigateToRow).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'button.cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockDeleteRows).not.toHaveBeenCalled();
  expect(mockNavigateToRow).not.toHaveBeenCalled();
});

it('does not navigate when confirming deletion in the real portalled modal', async () => {
  render(<FeedCard primaryFieldId='primary' rowId='row-1' />);
  fireEvent.keyDown(screen.getByTestId('feed-card-more-row-1'), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByTestId('feed-row-delete'));
  await screen.findByRole('dialog');
  expect(mockNavigateToRow).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('delete-row-confirm-button'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockDeleteRows).toHaveBeenCalledTimes(1);
  expect(mockDeleteRows).toHaveBeenCalledWith(['row-1']);
  expect(mockNavigateToRow).not.toHaveBeenCalled();
});
