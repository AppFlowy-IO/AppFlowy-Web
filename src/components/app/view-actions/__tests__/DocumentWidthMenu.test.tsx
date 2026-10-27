import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ViewService } from '@/application/services/domains';
import { View, ViewLayout } from '@/application/types';
import { DocumentWidthMenu } from '@/components/app/view-actions/DocumentWidthMenu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const mockUpdatePage = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/app/app.hooks', () => ({ useAppOperations: () => ({ updatePage: mockUpdatePage }) }));
jest.mock('@/application/services/domains', () => ({ ViewService: { getNavigation: jest.fn() } }));

const view: View = {
  view_id: 'page', name: 'Page', layout: ViewLayout.Document, icon: null,
  children: [], extra: null, is_private: false, is_published: false,
};
const latest = {
  ...view,
  name: 'Renamed since opening',
  extra: { font: 'Arial', future: { nested: true }, document_width: { mode: 'fixed', max_width: 960 } },
};

async function openMenu(disabled = false, onSaved = jest.fn()) {
  render(
    <DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger>More</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DocumentWidthMenu view={view} workspaceId='workspace' disabled={disabled} onSaved={onSaved} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const trigger = await screen.findByTestId('document-width-action');

  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  return onSaved;
}

beforeEach(() => {
  jest.clearAllMocks();
  (ViewService.getNavigation as jest.Mock).mockResolvedValue(latest);
  mockUpdatePage.mockResolvedValue(undefined);
});

it.each([
  ['full', { font: 'Arial', future: { nested: true }, document_width: { mode: 'full' } }],
  ['default', { font: 'Arial', future: { nested: true } }],
])('saving %s preserves fresh metadata and closes only after success', async (choice, extra) => {
  const onSaved = await openMenu();

  fireEvent.click(await screen.findByTestId(`document-width-${choice}`));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(ViewService.getNavigation).toHaveBeenCalledWith('workspace', 'page', 0);
  expect(mockUpdatePage).toHaveBeenCalledWith('page', { name: latest.name, extra });
  expect(screen.queryByTestId('document-width-menu')).toBeNull();
});

it('validates a custom width and leaves typing uncommitted', async () => {
  await openMenu();
  const input = await screen.findByTestId('document-width-input');
  const form = input.closest('form')!;

  fireEvent.change(input, { target: { value: '1921' } });
  fireEvent.submit(form);
  expect(mockUpdatePage).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('document.width.invalidWidth');
  fireEvent.change(input, { target: { value: '1200.5' } });
  expect(mockUpdatePage).not.toHaveBeenCalled();
  fireEvent.submit(form);
  await waitFor(() => expect(mockUpdatePage).toHaveBeenCalledTimes(1));
  expect(mockUpdatePage.mock.calls[0][1].extra.document_width).toEqual({ mode: 'fixed', max_width: 1200.5 });
});

it('shows a failed save, prevents duplicate writes and permits a retry', async () => {
  let rejectSave!: (error: Error) => void;

  mockUpdatePage.mockReturnValueOnce(new Promise<void>((_, reject) => { rejectSave = reject; }));
  const onSaved = await openMenu();
  const full = await screen.findByTestId('document-width-full');

  fireEvent.click(full);
  await waitFor(() => expect(mockUpdatePage).toHaveBeenCalledTimes(1));
  fireEvent.click(full);
  expect(mockUpdatePage).toHaveBeenCalledTimes(1);
  await act(async () => rejectSave(new Error('Network unavailable')));
  expect(screen.getByRole('alert').textContent).toBe('document.width.saveError');
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(full);
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(mockUpdatePage).toHaveBeenCalledTimes(2);
});

it('does not offer changes to a locked or read-only page', async () => {
  await openMenu(true);
  expect(screen.getByTestId('document-width-action').getAttribute('aria-disabled')).toBe('true');
  expect(screen.queryByTestId('document-width-menu')).toBeNull();
  expect(ViewService.getNavigation).not.toHaveBeenCalled();
  expect(mockUpdatePage).not.toHaveBeenCalled();
});
