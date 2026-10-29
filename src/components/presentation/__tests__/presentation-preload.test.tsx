import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import PresentEntry from '../PresentEntry';

// Each factory runs when its chunk is first requested, so the list records the request order.
const mockRequested: string[] = [];

jest.mock('../PresentationDialog', () => {
  mockRequested.push('dialog');
  return {
    __esModule: true,
    // This dialog never loads an inner chunk itself, so any inner request below is a preload.
    default: ({ mode, onClose }: { mode: string; onClose: () => void }) => (
      <button onClick={onClose}>Close {mode}</button>
    ),
  };
});
jest.mock('../DocumentPresenter', () => {
  mockRequested.push('document');
  return { __esModule: true, default: () => null };
});
jest.mock('../PresentationStudio', () => {
  mockRequested.push('studio');
  return { __esModule: true, default: () => null };
});

function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Present', exact: true }), { key: 'Enter' });
}

test('opening the Present menu fetches the dialog; choosing a mode fetches only that mode alongside it', async () => {
  render(<PresentEntry viewId='document' />);
  expect(mockRequested).toEqual([]);

  openMenu();
  await waitFor(() => expect(mockRequested).toEqual(['dialog']));

  fireEvent.click(await screen.findByRole('menuitem', { name: 'Present document' }));
  await waitFor(() => expect(mockRequested).toEqual(['dialog', 'document']));
  fireEvent.click(await screen.findByRole('button', { name: 'Close document' }));

  openMenu();
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Generate AI ppt' }));
  await waitFor(() => expect(mockRequested).toEqual(['dialog', 'document', 'studio']));
  expect(await screen.findByRole('button', { name: 'Close slides' })).toBeTruthy();
});
