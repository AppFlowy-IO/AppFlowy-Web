import { fireEvent, render, screen } from '@testing-library/react';

import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch';

import { GalleryCardToolbar } from '../GalleryCardToolbar';

jest.mock('@/application/database-yjs/dispatch', () => ({
  useDuplicateRowDispatch: jest.fn(),
}));

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

describe('GalleryCardToolbar Flutter desktop parity', () => {
  const duplicateRow = jest.fn();
  const onEdit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDuplicateRowDispatch.mockReturnValue(duplicateRow);
  });

  it('uses the exact accessory geometry, colors, shadow, motion, and focus treatment', () => {
    render(<GalleryCardToolbar onEdit={onEdit} rowId='row-1' />);

    const toolbar = screen.getByTestId('gallery-card-toolbar-row-1');
    const edit = screen.getByTestId('gallery-card-edit-row-1');
    const more = screen.getByTestId('gallery-card-more-row-1');
    const divider = screen.getByTestId('gallery-card-toolbar-divider');

    expect(toolbar.className).toContain('right-[7px]');
    expect(toolbar.className).toContain('top-[7px]');
    expect(toolbar.className).toContain('rounded-[4px]');
    expect(toolbar.className).toContain('border-[rgba(31,35,41,0.12)]');
    expect(toolbar.className).toContain('[[data-dark-mode=true]_&]:border-[#59647A]');
    expect(toolbar.className).toContain('bg-white');
    expect(toolbar.className).toContain('[[data-dark-mode=true]_&]:bg-[#1A202C]');
    expect(toolbar.className).toContain('shadow-[0_0_4px_rgba(31,35,41,0.02),0_0_4px_-2px_rgba(31,35,41,0.02)]');
    expect(toolbar.className).toContain('duration-200');
    expect(toolbar.className).toContain('motion-reduce:transition-none');

    for (const action of [edit, more]) {
      expect(action.className).toContain('h-[22px]');
      expect(action.className).toContain('w-6');
      expect(action.className).toContain('p-[3px]');
      expect(action.className).toContain('text-[#828282]');
      expect(action.className).toContain('[[data-dark-mode=true]_&]:text-[#59647A]');
      expect(action.className).toContain('hover:bg-white');
      expect(action.className).toContain('[[data-dark-mode=true]_&]:hover:bg-[#1A202C]');
      expect(action.className).toContain('focus-visible:ring-1');
      expect(action.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }

    expect(divider.className).toContain('h-[22px]');
    expect(divider.className).toContain('w-px');
    expect(divider.className).toContain('bg-[rgba(31,35,41,0.12)]');
    expect(divider.className).toContain('[[data-dark-mode=true]_&]:bg-[#59647A]');
  });

  it('aligns the 180px menu below the right edge with the Flutter offset', () => {
    render(<GalleryCardToolbar onEdit={onEdit} rowId='row-1' />);

    const menu = screen.getByTestId('gallery-row-action-menu');

    expect(menu.className).toContain('w-[180px]');
    expect(menu.className).toContain('!min-w-[180px]');
    expect(menu.getAttribute('data-side')).toBe('bottom');
    expect(menu.getAttribute('data-align')).toBe('end');
    expect(menu.getAttribute('data-side-offset')).toBe('8');
  });

  it('keeps edit, duplicate, and delete actions operable with accessible names', () => {
    render(<GalleryCardToolbar onEdit={onEdit} rowId='row-1' />);

    const edit = screen.getByRole('button', { name: 'button.edit' });
    const more = screen.getByRole('button', { name: 'tooltip.openMenu' });

    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('gallery-row-duplicate'));
    expect(duplicateRow).toHaveBeenCalledWith('row-1');

    fireEvent.click(screen.getByTestId('gallery-row-delete'));
    expect(screen.getByTestId('delete-row-confirm').textContent).toBe('row-1');
    expect(more.getAttribute('type')).toBe('button');
  });
});
