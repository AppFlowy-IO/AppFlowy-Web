import { act, fireEvent, render, screen } from '@testing-library/react';

import { useDatabaseContextOptional } from '@/application/database-yjs';
import { useRowPeekLayout } from '@/components/database/row-peek/RowPeekLayout';

import { ListRowPeekButton } from '../ListRowPeekButton';

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContextOptional: jest.fn(),
}));

// RowPeekLayout reaches Dexie through side-peek-width.ts.
jest.mock('@/components/database/row-peek/RowPeekLayout', () => ({
  useRowPeekLayout: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseDatabaseContextOptional = useDatabaseContextOptional as jest.MockedFunction<
  typeof useDatabaseContextOptional
>;
const mockUseRowPeekLayout = useRowPeekLayout as jest.MockedFunction<typeof useRowPeekLayout>;

type PeekLayout = ReturnType<typeof useRowPeekLayout>;
type DatabaseContext = ReturnType<typeof useDatabaseContextOptional>;

describe('ListRowPeekButton', () => {
  const navigateToRow = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDatabaseContextOptional.mockReturnValue({ navigateToRow } as DatabaseContext);
    mockUseRowPeekLayout.mockReturnValue({ canShow: true } as PeekLayout);
  });

  it('list_row.dart _PeekButton: a 20x20 ghost button shown only while the row is hovered or focused', () => {
    render(<ListRowPeekButton rowId='row-1' />);

    const button = screen.getByRole('button', { name: 'grid.rowPage.openAsSidePeekPanel' });

    expect(button.getAttribute('data-testid')).toBe('list-row-peek-row-1');
    // The e2e row locator is `[data-testid^="list-row-"][data-row-id]`.
    expect(button.getAttribute('data-row-id')).toBeNull();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('hidden');
    expect(button.className).toContain('group-hover/list-row:flex');
    expect(button.className).toContain('group-focus-within/list-row:flex');
    expect(button.className).toContain('ml-1.5');
    expect(button.className).toContain('h-5');
    expect(button.className).toContain('w-5');
    expect(button.className).toContain('rounded-300');
    expect(button.className).toContain('text-icon-primary');
    expect(button.className).toContain('hover:bg-fill-content-hover');
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('h-5 w-5');
  });

  it('opens the peek once without also firing the row click', () => {
    const onRowClick = jest.fn();

    render(
      <div onClick={onRowClick}>
        <ListRowPeekButton rowId='row-1' />
      </div>
    );

    fireEvent.click(screen.getByTestId('list-row-peek-row-1'));
    expect(navigateToRow).toHaveBeenCalledTimes(1);
    expect(navigateToRow).toHaveBeenCalledWith('row-1');
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('labels the center peek when the side peek cannot show or a page modal is open', () => {
    mockUseRowPeekLayout.mockReturnValue({ canShow: false } as PeekLayout);
    const { rerender } = render(<ListRowPeekButton rowId='row-1' />);

    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('grid.rowPage.openAsCenterPeekPanel');

    mockUseRowPeekLayout.mockReturnValue({ canShow: true } as PeekLayout);
    mockUseDatabaseContextOptional.mockReturnValue({ navigateToRow, openPageModalViewId: 'modal' } as DatabaseContext);
    rerender(<ListRowPeekButton rowId='row-1' />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('grid.rowPage.openAsCenterPeekPanel');

    mockUseRowPeekLayout.mockReturnValue(null);
    mockUseDatabaseContextOptional.mockReturnValue({ navigateToRow } as DatabaseContext);
    rerender(<ListRowPeekButton rowId='row-1' />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('grid.rowPage.openAsCenterPeekPanel');
  });

  it('renders nothing without a row navigator', () => {
    mockUseDatabaseContextOptional.mockReturnValue({} as DatabaseContext);
    const { container, rerender } = render(<ListRowPeekButton rowId='row-1' />);

    expect(container.firstChild).toBeNull();

    mockUseDatabaseContextOptional.mockReturnValue(undefined);
    rerender(<ListRowPeekButton rowId='row-1' />);
    expect(container.firstChild).toBeNull();
  });

  it('shows its tooltip above the button (desktop preferBelow: false)', async () => {
    render(<ListRowPeekButton rowId='row-1' />);

    act(() => screen.getByTestId('list-row-peek-row-1').focus());

    expect((await screen.findByRole('tooltip')).textContent).toBe('grid.rowPage.openAsSidePeekPanel');
    expect(document.querySelector('[data-slot="tooltip-content"]')?.getAttribute('data-side')).toBe('top');
  });
});
