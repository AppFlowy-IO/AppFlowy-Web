import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import mockEnglish from '@/@types/translations/en.json';
import type { View } from '@/application/types';

import { PageReferenceError } from '../PageReferenceError';

import type { ReferenceError } from '../usePageReferenceMetadata';

// The repository's lodash mock invokes debounce immediately. Use real timers
// here so entering the popup across its hover gap is actually exercised.
jest.unmock('lodash-es');

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const value = key.split('.').reduce<unknown>((current, part) =>
        typeof current === 'object' && current !== null
          ? (current as Record<string, unknown>)[part]
          : undefined, mockEnglish);

      return typeof value === 'string' ? value : key;
    },
  }),
}));

function Location() {
  return <output data-testid='location'>{useLocation().pathname}</output>;
}

function setup(error: ReferenceError, loadTrashViews = jest.fn().mockResolvedValue([])) {
  const retry = jest.fn();
  const result = render(
    <MemoryRouter initialEntries={['/app/workspace/shared-page']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Location />
      <PageReferenceError pageId='target' error={error} loading={false} retry={retry} loadTrashViews={loadTrashViews} />
    </MemoryRouter>
  );

  return { ...result, retry, loadTrashViews };
}

it.each([
  ['denied', 'No access', 'Ask the page owner to share it with you.'],
  ['not_found', 'Page not found', 'Ask the page owner for an updated link.'],
  ['deleted', 'Page not found', 'Ask the page owner for an updated link.'],
] as const)('hover explains %s without navigating or reading Trash', async (error, label, explanation) => {
  const { loadTrashViews, retry } = setup(error);

  fireEvent.mouseEnter(screen.getByRole('button', { name: label }));
  const dialog = await screen.findByRole('dialog', { name: label });

  expect(dialog.textContent).toContain(explanation);
  expect(screen.getByTestId('location').textContent).toBe('/app/workspace/shared-page');
  expect(screen.queryByRole('button', { name: 'Open Trash' })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(loadTrashViews).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
});

it('hover checks the viewer’s Trash list before offering a working popup action', async () => {
  let resolveTrash!: (views: View[]) => void;
  const loadTrashViews = jest.fn(() => new Promise<View[]>((resolve) => { resolveTrash = resolve; }));

  setup('in_trash', loadTrashViews);
  expect(loadTrashViews).not.toHaveBeenCalled();
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Page in Trash' }));
  const dialog = await screen.findByRole('dialog', { name: 'Page in Trash' });

  expect(screen.queryByRole('button', { name: 'Open Trash' })).toBeNull();
  await act(async () => { resolveTrash([{ view_id: 'target' } as View]); });
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Open Trash' }));

  expect(screen.getByTestId('location').textContent).toBe('/app/trash');
  expect(loadTrashViews).toHaveBeenCalledTimes(1);
});

it.each(['absent', 'denied'] as const)('hover keeps Trash navigation hidden when access is %s', async (outcome) => {
  const loadTrashViews = outcome === 'denied'
    ? jest.fn().mockRejectedValue({ code: 403 })
    : jest.fn().mockResolvedValue([{ view_id: 'another-page' }]);

  setup('in_trash', loadTrashViews);
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Page in Trash' }));
  await waitFor(() => expect(loadTrashViews).toHaveBeenCalledTimes(1));

  expect(screen.getByRole('dialog', { name: 'Page in Trash' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open Trash' })).toBeNull();
  expect(screen.getByTestId('location').textContent).toBe('/app/workspace/shared-page');
});

it('hover offers Retry inside the failure popup and invokes the existing loader once', async () => {
  const { retry } = setup('load_failed');

  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Couldn’t load page' }));
  const dialog = await screen.findByRole('dialog', { name: 'Couldn’t load page' });

  expect(dialog.textContent).toContain('Check your connection and try again.');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('keeps inline Retry available without opening the popup', () => {
  const { retry } = setup('load_failed');

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('disables both Retry actions while the reference request is pending', async () => {
  const retry = jest.fn();

  render(<PageReferenceError pageId='target' error='load_failed' loading retry={retry} />);
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Couldn’t load page' }));
  await screen.findByRole('dialog', { name: 'Couldn’t load page' });
  const actions = screen.getAllByRole('button', { name: 'Retry' });

  expect(actions).toHaveLength(2);

  for (const action of actions) {
    expect((action as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(action);
  }

  expect(retry).not.toHaveBeenCalled();
});

it('retains click activation and Escape dismissal for keyboard users', async () => {
  setup('denied');
  const trigger = screen.getByRole('button', { name: 'No access' });

  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'No access' });

  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

it('keeps the popup reachable across the hover gap and closes after leaving it', async () => {
  jest.useFakeTimers();
  try {
    const { unmount } = setup('load_failed');
    const trigger = screen.getByRole('button', { name: 'Couldn’t load page' });

    fireEvent.mouseEnter(trigger);
    await act(async () => { jest.advanceTimersByTime(120); });
    const dialog = screen.getByRole('dialog', { name: 'Couldn’t load page' });

    expect(document.activeElement).not.toBe(within(dialog).getByRole('button', { name: 'Retry' }));
    fireEvent.mouseLeave(trigger);
    await act(async () => { jest.advanceTimersByTime(100); });
    fireEvent.mouseEnter(dialog);
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(screen.getByRole('dialog')).toBe(dialog);
    fireEvent.mouseLeave(dialog);
    await act(async () => { jest.advanceTimersByTime(240); });
    expect(screen.queryByRole('dialog')).toBeNull();

    // A quick pass across a reference must not open a delayed popup afterward.
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(trigger);
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
  } finally {
    jest.useRealTimers();
  }
});

it('keeps focused popup actions usable after the pointer leaves', async () => {
  jest.useFakeTimers();
  try {
    const { unmount, retry } = setup('load_failed');

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Couldn’t load page' }));
    await act(async () => { jest.advanceTimersByTime(120); });
    const dialog = screen.getByRole('dialog', { name: 'Couldn’t load page' });
    const action = within(dialog).getByRole('button', { name: 'Retry' });

    act(() => { action.focus(); });
    fireEvent.mouseLeave(dialog);
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(screen.getByRole('dialog')).toBe(dialog);
    fireEvent.click(action);
    expect(retry).toHaveBeenCalledTimes(1);
    unmount();
  } finally {
    jest.useRealTimers();
  }
});
