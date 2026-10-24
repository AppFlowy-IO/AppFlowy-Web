import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import mockEnglish from '@/@types/translations/en.json';
import type { View } from '@/application/types';

import { PageReferenceError } from '../PageReferenceError';

import type { ReferenceError } from '../usePageReferenceMetadata';

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
] as const)('explains %s without navigating or reading Trash', async (error, label, explanation) => {
  const { loadTrashViews, retry } = setup(error);

  fireEvent.click(screen.getByRole('button', { name: label }));
  const dialog = await screen.findByRole('dialog', { name: label });

  expect(dialog.textContent).toContain(explanation);
  expect(screen.getByTestId('location').textContent).toBe('/app/workspace/shared-page');
  expect(screen.queryByRole('button', { name: 'Open Trash' })).toBeNull();
  expect(loadTrashViews).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
});

it('checks the viewer’s Trash list on demand before offering navigation', async () => {
  let resolveTrash!: (views: View[]) => void;
  const loadTrashViews = jest.fn(() => new Promise<View[]>((resolve) => { resolveTrash = resolve; }));

  setup('in_trash', loadTrashViews);
  expect(loadTrashViews).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Page in Trash' }));
  expect(screen.queryByRole('button', { name: 'Open Trash' })).toBeNull();
  await act(async () => { resolveTrash([{ view_id: 'target' } as View]); });
  fireEvent.click(await screen.findByRole('button', { name: 'Open Trash' }));

  expect(screen.getByTestId('location').textContent).toBe('/app/trash');
  expect(loadTrashViews).toHaveBeenCalledTimes(1);
});

it.each(['absent', 'denied'] as const)('keeps Trash navigation hidden when access is %s', async (outcome) => {
  const loadTrashViews = outcome === 'denied'
    ? jest.fn().mockRejectedValue({ code: 403 })
    : jest.fn().mockResolvedValue([{ view_id: 'another-page' }]);

  setup('in_trash', loadTrashViews);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Page in Trash' })); });
  await waitFor(() => expect(loadTrashViews).toHaveBeenCalledTimes(1));

  expect(screen.getByRole('dialog', { name: 'Page in Trash' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open Trash' })).toBeNull();
  expect(screen.getByTestId('location').textContent).toBe('/app/workspace/shared-page');
});

it('uses the compact load failure label and retries through the existing loader', () => {
  const { retry } = setup('load_failed');

  expect(screen.getByRole('button', { name: 'Couldn’t load page' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
