import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch';

import { GalleryCardToolbar } from '../GalleryCardToolbar';

jest.mock('@/application/database-yjs/dispatch', () => ({
  useDuplicateRowDispatch: jest.fn(),
}));
jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: () => ({ activeViewId: 'view-1', databasePageId: 'page-1', variant: 'app', workspaceId: 'ws-1' }),
}));
const mockCopyTextToClipboard = jest.fn(() => Promise.resolve());

jest.mock('@/utils/copy', () => ({ copyTextToClipboard: (text: string) => mockCopyTextToClipboard(text) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn() } }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({
    align,
    children,
    className,
    side,
    sideOffset,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    align?: string;
    side?: string;
    sideOffset?: number;
  }) => (
    <div {...props} className={className} data-align={align} data-side={side} data-side-offset={sideOffset}>
      {children}
    </div>
  ),
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({
    children,
    onSelect,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    onSelect?: () => void;
    variant?: string;
  }) => (
    <button {...props} onClick={onSelect} type='button'>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/database/components/database-row/DeleteRowConfirm', () => ({
  DeleteRowConfirm: ({ open, rowIds }: { open: boolean; rowIds: string[] }) =>
    open ? <div data-testid='delete-row-confirm'>{rowIds.join(',')}</div> : null,
}));

const mockUseDuplicateRowDispatch = useDuplicateRowDispatch as jest.MockedFunction<typeof useDuplicateRowDispatch>;

describe('GalleryCardToolbar Figma parity', () => {
  const duplicateRow = jest.fn();
  const onEdit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDuplicateRowDispatch.mockReturnValue(duplicateRow);
  });

  it('offers cover controls and replaces them with Save and Cancel during repositioning', () => {
    const onReposition = jest.fn();
    const onSaveReposition = jest.fn();
    const onCancelReposition = jest.fn();
    const props = { onEdit, onReposition, onSaveReposition, onCancelReposition, rowId: 'row-1' };
    const { rerender } = render(<GalleryCardToolbar {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'gallery.reposition' }));
    expect(onReposition).toHaveBeenCalledTimes(1);
    rerender(<GalleryCardToolbar {...props} repositioning />);
    expect(screen.queryByRole('button', { name: 'button.rename' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'button.save' }));
    fireEvent.click(screen.getByRole('button', { name: 'button.cancel' }));
    expect(onSaveReposition).toHaveBeenCalledTimes(1);
    expect(onCancelReposition).toHaveBeenCalledTimes(1);
  });

  it('exposes no editing actions in read-only mode', () => {
    render(<GalleryCardToolbar onEdit={onEdit} onReposition={jest.fn()} rowId='row-1' readOnly />);
    expect(screen.queryByTestId('gallery-card-toolbar-row-1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'button.rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'button.more' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'gallery.reposition' })).toBeNull();
  });

  it('aligns the 240px Figma menu below the right edge', () => {
    render(<GalleryCardToolbar onEdit={onEdit} rowId='row-1' />);

    const menu = screen.getByTestId('gallery-row-action-menu');

    expect(menu.className).toContain('w-[240px]');
    expect(menu.className).toContain('!min-w-[240px]');
    expect(menu.getAttribute('data-side')).toBe('bottom');
    expect(menu.getAttribute('data-align')).toBe('end');
    expect(menu.getAttribute('data-side-offset')).toBe('8');
  });

  it('shows Reposition, Rename and More in the Figma order', () => {
    render(<GalleryCardToolbar onEdit={onEdit} onReposition={jest.fn()} rowId='row-1' />);

    const labels = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
      .filter(Boolean);

    expect(labels.slice(0, 3)).toEqual(['gallery.reposition', 'button.rename', 'button.more']);
    expect(screen.queryByTestId('gallery-card-peek-row-1')).toBeNull();
  });

  it('copies the row page link from the More menu', async () => {
    render(<GalleryCardToolbar onEdit={onEdit} rowId='row-1' />);

    const items = Array.from(screen.getByTestId('gallery-row-action-menu').querySelectorAll('button'));

    expect(items.map((item) => item.dataset.testid)).toEqual([
      'gallery-row-copy-link',
      'gallery-row-duplicate',
      'gallery-row-delete',
    ]);
    fireEvent.click(screen.getByTestId('gallery-row-copy-link'));
    await waitFor(() =>
      expect(mockCopyTextToClipboard).toHaveBeenCalledWith(`${window.location.origin}/app/ws-1/page-1?v=view-1&r=row-1`)
    );
    // Delete keeps the primary color at rest and turns red only while highlighted.
    expect(screen.getByTestId('gallery-row-delete').className).toContain('hover:text-text-error');
    expect(screen.getByTestId('gallery-row-delete').className).not.toMatch(/(^|\s)text-text-error/);
  });

  it('keeps rename, duplicate, and delete actions operable with accessible names', () => {
    render(<GalleryCardToolbar onEdit={onEdit} rowId='row-1' />);

    const edit = screen.getByRole('button', { name: 'button.rename' });
    const more = screen.getByRole('button', { name: 'button.more' });

    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('gallery-row-duplicate'));
    expect(duplicateRow).toHaveBeenCalledWith('row-1');

    fireEvent.click(screen.getByTestId('gallery-row-delete'));
    expect(screen.getByTestId('delete-row-confirm').textContent).toBe('row-1');
    expect(more.getAttribute('type')).toBe('button');
  });
});
