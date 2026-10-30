import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AISlidesSharePanel from '../AISlidesSharePanel';
import { listSavedDecks, loadSavedDeck } from '../presentation-client';
import { preloadPresentation } from '../presentation-preload';
import { forgetSavedDecks } from '../saved-deck-cache';

import type { SavedDeck, SavedDeckSummary } from '../types';

let mockUserId = 'user';
let mockCanRead = true;

jest.mock('../presentation-client', () => ({ listSavedDecks: jest.fn(), loadSavedDeck: jest.fn() }));
jest.mock('../presentation-preload', () => ({ preloadPresentation: jest.fn() }));
jest.mock('@/components/app/app.hooks', () => ({
  useAppView: (id: string) => ({ view_id: id }),
  useCurrentWorkspaceId: () => 'workspace',
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => ({ uid: mockUserId }) }));
jest.mock('@/components/app/view-actions/useViewActionPermissions', () => ({
  useViewActionPermissions: () => ({ canRead: mockCanRead, canWrite: mockCanRead }),
}));

const deck = {
  id: 'deck',
  version: 2,
  plan: { title: 'Quarterly review', slides: [] },
  style: { name: 'Paper' },
  createdAt: '2026-10-28T00:00:00Z',
} as unknown as SavedDeck;
const summary: SavedDeckSummary = {
  id: deck.id,
  version: deck.version!,
  title: deck.plan.title,
  slideCount: deck.plan.slides.length,
  createdAt: deck.createdAt,
};
const onOpen = jest.fn();
const panel = (viewId = 'page') => <AISlidesSharePanel viewId={viewId} onOpen={onOpen} />;

beforeEach(() => {
  jest.mocked(listSavedDecks).mockReset().mockResolvedValue([summary]);
  jest.mocked(loadSavedDeck).mockReset().mockResolvedValue(deck);
  jest.mocked(preloadPresentation).mockClear();
  onOpen.mockClear();
  mockUserId = 'user';
  mockCanRead = true;
});
afterEach(() => {
  jest.restoreAllMocks();
  forgetSavedDecks('workspace', 'user');
  forgetSavedDecks('workspace', 'another-user');
});

test('lists the workspace catalog once across tab visits and pages', async () => {
  const first = render(panel());

  expect(await screen.findByText('Quarterly review')).toBeTruthy();
  first.unmount();
  // Radix tabs unmount the panel whenever another tab is selected.
  const second = render(panel());

  expect(screen.getByText('Quarterly review')).toBeTruthy();
  second.unmount();
  render(panel('another-page'));
  expect(screen.getByText('Quarterly review')).toBeTruthy();
  expect(listSavedDecks).toHaveBeenCalledTimes(1);
  expect(loadSavedDeck).not.toHaveBeenCalled();
});

test('lists again after the cache expires, for another user, and after it is forgotten', async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  const first = render(panel());

  await screen.findByText('Quarterly review');
  first.unmount();
  clock.mockReturnValue(now + 61 * 1000);
  const expired = render(panel());

  await screen.findByText('Quarterly review');
  expect(listSavedDecks).toHaveBeenCalledTimes(2);
  expired.unmount();

  mockUserId = 'another-user';
  const otherUser = render(panel());

  await screen.findByText('Quarterly review');
  expect(listSavedDecks).toHaveBeenCalledTimes(3);
  otherUser.unmount();

  mockUserId = 'user';
  forgetSavedDecks('workspace', 'user');
  render(panel());
  await screen.findByText('Quarterly review');
  expect(listSavedDecks).toHaveBeenCalledTimes(4);
});

test('does not keep a failed list, and Retry reads the catalog again', async () => {
  jest.mocked(listSavedDecks).mockRejectedValueOnce(new Error('Catalog unavailable'));
  render(panel());

  expect((await screen.findByRole('alert')).textContent).toContain('Catalog unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Quarterly review')).toBeTruthy();
  expect(listSavedDecks).toHaveBeenCalledTimes(2);
});

test('opening a deck starts the studio chunk alongside the dialog', async () => {
  render(panel());

  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
  expect(preloadPresentation).toHaveBeenCalledWith('slides');
  expect(loadSavedDeck).toHaveBeenCalledWith(
    { workspaceId: 'workspace', pageId: 'page' }, summary.id, summary.version, expect.any(AbortSignal)
  );
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(deck, 'preview'));
  fireEvent.click(screen.getByRole('button', { name: 'Create AI Slides' }));
  expect(preloadPresentation).toHaveBeenCalledTimes(2);
  expect(onOpen).toHaveBeenLastCalledWith(undefined, undefined);
});

test('a failed selected scene keeps catalog cards visible and can be retried', async () => {
  jest.mocked(loadSavedDeck).mockRejectedValueOnce(new Error('Scene unavailable'));
  render(panel());
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));

  expect((await screen.findByRole('alert')).textContent).toBe('Scene unavailable');
  expect(screen.getByText('Quarterly review')).toBeTruthy();
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(deck, 'preview'));
  expect(loadSavedDeck).toHaveBeenCalledTimes(2);
  expect(listSavedDecks).toHaveBeenCalledTimes(1);
});

test.each(['unmount', 'account', 'permission'] as const)('aborts opening after %s changes and ignores a late deck', async (change) => {
  let finish!: (value: SavedDeck) => void;

  jest.mocked(loadSavedDeck).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(panel());

  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
  expect(screen.getByText('Opening presentation…')).toBeTruthy();
  const signal = jest.mocked(loadSavedDeck).mock.calls[0][3]!;

  if (change === 'unmount') view.unmount();
  else {
    if (change === 'account') mockUserId = 'another-user';
    else mockCanRead = false;
    view.rerender(panel());
  }

  expect(signal.aborted).toBe(true);
  await act(async () => finish(deck));
  expect(onOpen).not.toHaveBeenCalled();
});

test('partial catalog failures leave healthy entries visible and are retried on the next visit', async () => {
  jest.mocked(listSavedDecks).mockResolvedValueOnce([
    summary,
    { id: 'unavailable', version: 1, createdAt: summary.createdAt, error: 'Artifact unavailable' },
  ]);
  const first = render(panel());

  await screen.findByText('Quarterly review');
  expect(screen.getByRole('alert').textContent).toBe('Artifact unavailable');
  first.unmount();
  render(panel());
  await screen.findByText('Quarterly review');
  expect(listSavedDecks).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});
