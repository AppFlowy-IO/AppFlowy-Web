import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { toast } from 'sonner';

import { GalleryCardSize } from '@/application/types';
import GridNewRow from '@/components/database/components/grid/grid-row/GridNewRow';
import { FeedNewRow } from '@/components/database/feed/FeedControls';
import { GalleryNewRow } from '@/components/database/gallery/GalleryNewRow';
import { ListNewRow } from '@/components/database/list/ListControls';

import { useRowCreationAction } from '../useRowCreationAction';

const mockCreate = jest.fn();

jest.mock('@/application/database-yjs/dispatch', () => ({ useNewRowDispatch: () => mockCreate }));
jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: () => ({ isDocumentBlock: false }),
  useDatabaseFields: () => undefined,
  useDatabaseView: () => undefined,
}));
jest.mock('@/components/database/grid/useGridContext', () => ({
  useGridContext: () => ({ revealCreatedRow: jest.fn() }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/utils/errors', () => ({ getErrorMessage: () => 'Localized refusal' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function barrier() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it.each([
  ['grid-new-row', () => <GridNewRow />],
  ['list-new-row', () => <ListNewRow />],
  ['feed-new-row', () => <FeedNewRow />],
  ['gallery-new-row', () => <GalleryNewRow cardSize={GalleryCardSize.Medium} />],
])('%s keeps loading and prevents another gesture until server activation completes', async (id, component) => {
  const held = barrier();

  mockCreate.mockReturnValue(held.promise);
  render(component());
  const button = screen.getByTestId(id);

  fireEvent.click(button);
  fireEvent.click(button);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(button.querySelector('.animate-spin')).toBeTruthy();
  expect(mockCreate).toHaveBeenCalledTimes(1);
  await act(async () => held.resolve());
  expect(button.getAttribute('aria-busy')).toBe('false');
  expect((button as HTMLButtonElement).disabled).toBe(false);
});

it('a refused gesture reports a localized error and remains usable without a recovery banner', async () => {
  mockCreate.mockRejectedValue({ code: 403, message: 'technical detail' });
  render(<ListNewRow />);
  const button = screen.getByTestId('list-new-row');

  await act(async () => fireEvent.click(button));
  expect(toast.error).toHaveBeenCalledWith('Localized refusal');
  expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(button.getAttribute('aria-busy')).toBe('false');
  expect(screen.queryByText('Retry')).toBeNull();
});

it('guards reentry before React renders, and does not report completion after unmount', async () => {
  const held = barrier();
  const action = jest.fn(() => held.promise);
  const { result, unmount } = renderHook(() => useRowCreationAction());
  let first!: ReturnType<typeof result.current.run>;

  act(() => {
    first = result.current.run(action);
    void result.current.run(action);
  });
  expect(action).toHaveBeenCalledTimes(1);
  unmount();
  held.resolve();
  await expect(first).resolves.toEqual({ ok: false });
  expect(toast.error).not.toHaveBeenCalled();
});
