import { fireEvent, render, screen } from '@testing-library/react';

import AISlidesSharePanel from '../AISlidesSharePanel';
import { listSavedDecks } from '../presentation-client';
import { preloadPresentation } from '../presentation-preload';
import { forgetSavedDecks } from '../saved-deck-cache';

import type { SavedDeck } from '../types';

let mockUserId = 'user';

jest.mock('../presentation-client', () => ({ listSavedDecks: jest.fn() }));
jest.mock('../presentation-preload', () => ({ preloadPresentation: jest.fn() }));
jest.mock('@/components/app/app.hooks', () => ({
  useAppView: (id: string) => ({ view_id: id }),
  useCurrentWorkspaceId: () => 'workspace',
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => ({ uid: mockUserId }) }));
jest.mock('@/components/app/view-actions/useViewActionPermissions', () => ({
  useViewActionPermissions: () => ({ canRead: true, canWrite: true }),
}));

const deck = {
  id: 'deck',
  version: 2,
  plan: { title: 'Quarterly review', slides: [] },
  style: { name: 'Paper' },
  createdAt: '2026-10-28T00:00:00Z',
} as unknown as SavedDeck;
const onOpen = jest.fn();
const panel = (viewId = 'page') => <AISlidesSharePanel viewId={viewId} onOpen={onOpen} />;

beforeEach(() => {
  jest.mocked(listSavedDecks).mockReset().mockResolvedValue([deck]);
  jest.mocked(preloadPresentation).mockClear();
  onOpen.mockClear();
  mockUserId = 'user';
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
  expect(onOpen).toHaveBeenCalledWith(deck, 'preview');
  fireEvent.click(screen.getByRole('button', { name: 'Create AI Slides' }));
  expect(preloadPresentation).toHaveBeenCalledTimes(2);
  expect(onOpen).toHaveBeenLastCalledWith(undefined, undefined);
});
