import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ensureRowDocumentView, syncRowDocumentViewName } from '@/application/row-document/lifecycle';
import { PageService } from '@/application/services/domains';
import { UIVariant } from '@/application/types';
import { RowPeekDocumentActions } from '@/components/database/row-peek/RowPeekDocumentActions';

let mockVariant = UIVariant.App;
let mockDatabaseId: string | undefined = 'database-id';
let mockTitle = 'Original title';
let mockRowLoaded = true;
const mockPrepare = jest.fn<Promise<boolean>, []>();
const mockLoadFavorites = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/database-yjs', () => ({
  useDatabaseContextOptional: () => ({
    workspaceId: 'workspace',
    databasePageId: 'database-page',
    activeViewId: 'board-view',
    variant: mockVariant,
  }),
  useDatabase: () => ({ get: () => mockDatabaseId }),
  usePrimaryFieldId: () => 'title',
  useRowDataSelector: () => ({
    row: mockRowLoaded ? { get: () => new Map([['title', new Map([['data', mockTitle]])]]) } : undefined,
  }),
  useRowMetaSelector: () => undefined,
}));
jest.mock('@/application/row-document/lifecycle', () => ({
  rowDocumentIdFromRowId: (rowId: string) => `document-${rowId}`,
  ensureRowDocumentView: jest.fn(),
  syncRowDocumentViewName: jest.fn(),
}));
jest.mock('@/application/services/domains', () => ({ PageService: { favorite: jest.fn() } }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace',
  useAppFavorites: () => ({ favoriteViews: [], loadFavoriteViews: mockLoadFavorites }),
}));
jest.mock('@/components/app/header/Users', () => ({
  Users: ({ viewId, maxVisibleUsers }: { viewId: string; maxVisibleUsers: number }) => (
    <div data-testid='collaborators' data-view-id={viewId} data-limit={maxVisibleUsers} />
  ),
}));
jest.mock('@/components/app/share/ShareButton', () => ({
  ShareButton: ({
    viewId,
    shareUrl,
    hidePublish,
    hideExport,
  }: {
    viewId: string;
    shareUrl?: string;
    hidePublish: boolean;
    hideExport: boolean;
  }) => (
    <div
      data-testid='share'
      data-view-id={viewId}
      data-url={shareUrl}
      data-hide-publish={hidePublish}
      data-hide-export={hideExport}
    />
  ),
}));

function Fixture({ rowId = 'first' }: { rowId?: string }) {
  return (
    <RowPeekDocumentActions
      rowId={rowId}
      prepare={mockPrepare}
      shareUrl={`https://app.test/app/workspace/database-page?v=board-view&r=${rowId}`}
    >
      <button>Peek mode</button>
    </RowPeekDocumentActions>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVariant = UIVariant.App;
  mockDatabaseId = 'database-id';
  mockTitle = 'Original title';
  mockRowLoaded = true;
  mockPrepare.mockResolvedValue(true);
  jest.mocked(ensureRowDocumentView).mockResolvedValue(true);
  jest.mocked(PageService.favorite).mockResolvedValue(undefined);
});

it('uses row collaborators and links, while inheriting access from the database', () => {
  const { rerender } = render(<Fixture />);

  expect(screen.getByTestId('collaborators').getAttribute('data-view-id')).toBe('document-first');
  expect(screen.getByTestId('collaborators').getAttribute('data-limit')).toBe('3');
  const share = screen.getByTestId('share');

  expect(share.getAttribute('data-view-id')).toBe('database-page');
  expect(share.getAttribute('data-url')).toContain('v=board-view&r=first');
  expect(share.getAttribute('data-hide-publish')).toBe('true');
  expect(share.getAttribute('data-hide-export')).toBe('true');
  rerender(<Fixture rowId='second' />);
  expect(screen.getByTestId('collaborators').getAttribute('data-view-id')).toBe('document-second');
  expect(screen.getByTestId('share').getAttribute('data-url')).toContain('r=second');
});

it('commits and materializes the row before favoriting it with the saved title', async () => {
  mockPrepare.mockImplementation(async () => {
    mockTitle = '  Committed draft  ';
    return true;
  });
  render(<Fixture />);
  fireEvent.click(screen.getByTestId('favorite-button'));
  await waitFor(() => expect(PageService.favorite).toHaveBeenCalledWith('workspace', 'document-first', true, true));
  expect(ensureRowDocumentView).toHaveBeenCalledWith('workspace', 'document-first', {
    database_id: 'database-id',
    database_view_id: 'board-view',
    row_id: 'first',
  });
  expect(syncRowDocumentViewName).toHaveBeenCalledWith('workspace', 'document-first', 'Committed draft');
  expect(mockPrepare.mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(ensureRowDocumentView).mock.invocationCallOrder[0]
  );
  expect(jest.mocked(syncRowDocumentViewName).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(PageService.favorite).mock.invocationCallOrder[0]
  );
});

it.each(['commit', 'materialization'])('aborts favorite when %s fails', async (failure) => {
  mockPrepare.mockResolvedValue(failure !== 'commit');
  jest.mocked(ensureRowDocumentView).mockResolvedValue(failure !== 'materialization');
  render(<Fixture />);
  await act(async () => {
    fireEvent.click(screen.getByTestId('favorite-button'));
  });
  expect(PageService.favorite).not.toHaveBeenCalled();
  expect(syncRowDocumentViewName).not.toHaveBeenCalled();
  expect(screen.getByTestId('favorite-button').getAttribute('aria-pressed')).toBe('false');
});

it('does not carry a pending favorite state into the next row', async () => {
  let finish!: () => void;

  jest.mocked(PageService.favorite).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const { rerender } = render(<Fixture />);

  fireEvent.click(screen.getByTestId('favorite-button'));
  await waitFor(() => expect(PageService.favorite).toHaveBeenCalledTimes(1));
  rerender(<Fixture rowId='second' />);
  expect(screen.getByTestId('favorite-button').getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByTestId('favorite-button').hasAttribute('disabled')).toBe(false);
  await act(async () => {
    finish();
  });
  fireEvent.click(screen.getByTestId('favorite-button'));
  await waitFor(() => expect(PageService.favorite).toHaveBeenLastCalledWith('workspace', 'document-second', true, true));
});

it('never falls back to favoriting the database while its source is loading', () => {
  mockDatabaseId = undefined;
  render(<Fixture />);
  expect(screen.queryByTestId('favorite-button')).toBeNull();
  expect(screen.getByTestId('share')).toBeTruthy();
});

it('waits for the row title to load before making favorite available', () => {
  mockRowLoaded = false;
  const { rerender } = render(<Fixture />);

  expect(screen.queryByTestId('favorite-button')).toBeNull();
  mockRowLoaded = true;
  rerender(<Fixture />);
  expect(screen.getByTestId('favorite-button')).toBeTruthy();
});

it('keeps layout controls but omits workspace actions on published rows', () => {
  mockVariant = UIVariant.Publish;
  render(<Fixture />);
  expect(screen.getByRole('button', { name: 'Peek mode' })).toBeTruthy();
  expect(screen.queryByTestId('share')).toBeNull();
  expect(screen.queryByTestId('favorite-button')).toBeNull();
});
