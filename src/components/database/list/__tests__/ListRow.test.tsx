import { fireEvent, render, screen } from '@testing-library/react';

import {
  useDatabaseContext,
  useDatabaseContextOptional,
  useIsRowLoaded,
  useReadOnly,
  useRowCommentCount,
  useRowMetaSelector,
} from '@/application/database-yjs';
import type { Column } from '@/application/database-yjs';

import { ListRow } from '../ListRow';
import { ListRowLayoutProvider } from '../ListRowLayout';

jest.mock('@/application/database-yjs', () => ({
  FieldType: {
    Checkbox: 5,
    MultiSelect: 4,
    RichText: 0,
    SingleSelect: 3,
  },
  SelectOptionColor: {},
  useCellSelector: ({ fieldId }: { fieldId: string }) => ({ data: fieldId }),
  useDatabaseContext: jest.fn(),
  useDatabaseContextOptional: jest.fn(),
  useIsRowLoaded: jest.fn(),
  useReadOnly: jest.fn(),
  useRowCommentCount: jest.fn(),
  useRowMetaSelector: jest.fn(),
}));

const mockUpdateCell = jest.fn();

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateCellDispatch: () => mockUpdateCell,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      key === 'grid.row.titlePlaceholder' ? 'Untitled' : options?.defaultValue ?? key,
  }),
}));

jest.mock('@/components/database/components/cell/Cell', () => ({
  Cell: ({ fieldId, placeholder }: { fieldId: string; placeholder?: string }) =>
    fieldId === 'interactive' ? (
      <button type='button'>Cell action</button>
    ) : fieldId === 'title' ? (
      <span data-placeholder={placeholder} data-testid='mock-primary-cell'>
        Title
      </span>
    ) : (
      <span>{fieldId}</span>
    ),
}));

jest.mock('@/components/database/components/sorts/ClearSortingConfirm', () => ({
  __esModule: true,
  ClearSortingConfirm: () => null,
}));

// RowPeekLayout reaches Dexie through side-peek-width.ts.
jest.mock('@/components/database/row-peek/RowPeekLayout', () => ({
  useRowPeekLayout: () => ({ canShow: true }),
}));

jest.mock('../ListRowActions', () => ({
  ListRowActions: ({ rowId }: { rowId: string }) => (
    <button data-testid={`list-row-actions-${rowId}`} type='button'>
      Actions
    </button>
  ),
}));

const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
const mockUseDatabaseContextOptional = useDatabaseContextOptional as jest.MockedFunction<
  typeof useDatabaseContextOptional
>;
const mockUseIsRowLoaded = useIsRowLoaded as jest.MockedFunction<typeof useIsRowLoaded>;
const mockUseReadOnly = useReadOnly as jest.MockedFunction<typeof useReadOnly>;
const mockUseRowCommentCount = useRowCommentCount as jest.MockedFunction<typeof useRowCommentCount>;
const mockUseRowMetaSelector = useRowMetaSelector as jest.MockedFunction<typeof useRowMetaSelector>;

const fields = [
  { fieldId: 'leading', fieldType: 5, isPrimary: false },
  { fieldId: 'title', fieldType: 0, isPrimary: true },
  { fieldId: 'interactive', fieldType: 0, isPrimary: false },
] as Column[];

describe('ListRow Desktop parity', () => {
  const navigateToRow = jest.fn();
  const bindRowSync = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({ bindRowSync, navigateToRow } as ReturnType<typeof useDatabaseContext>);
    mockUseDatabaseContextOptional.mockReturnValue({ bindRowSync, navigateToRow } as ReturnType<
      typeof useDatabaseContextOptional
    >);
    mockUseIsRowLoaded.mockReturnValue(true);
    mockUseReadOnly.mockReturnValue(false);
    mockUseRowCommentCount.mockReturnValue(0);
    mockUseRowMetaSelector.mockReturnValue(undefined);
  });

  function renderRow(rowFields: Column[] = fields) {
    return render(
      <ListRow fields={rowFields} reorderable={false} rowId='row-1' rowOrders={[{ height: 36, id: 'row-1' }]} />
    );
  }

  function renderNarrowRow(rowFields: Column[] = fields) {
    return render(
      <ListRowLayoutProvider value='narrow'>
        <ListRow fields={rowFields} reorderable={false} rowId='row-1' rowOrders={[{ height: 36, id: 'row-1' }]} />
      </ListRowLayoutProvider>
    );
  }

  it('database_list_property_order_test.dart: leading property respects visibility and renders before primary field', () => {
    const initiallyTrailingFields = [fields[1], fields[0], fields[2]];
    const { rerender } = render(
      <ListRow
        fields={initiallyTrailingFields}
        reorderable={false}
        rowId='row-1'
        rowOrders={[{ height: 36, id: 'row-1' }]}
      />
    );

    let leading = screen.getByTestId('list-field-leading-row-1');
    let primary = screen.getByTestId('list-primary-cell-row-1');

    expect(primary.compareDocumentPosition(leading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('list-row-trailing-row-1').contains(leading)).toBe(true);

    rerender(<ListRow fields={fields} reorderable={false} rowId='row-1' rowOrders={[{ height: 36, id: 'row-1' }]} />);

    leading = screen.getByTestId('list-field-leading-row-1');
    primary = screen.getByTestId('list-primary-cell-row-1');
    const trailing = screen.getByTestId('list-field-interactive-row-1');
    const titleRow = screen.getByTestId('list-row-title-row-1');
    const trailingStrip = screen.getByTestId('list-row-trailing-row-1');

    expect(leading.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(primary.compareDocumentPosition(trailing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(titleRow.contains(leading)).toBe(true);
    expect(titleRow.contains(primary)).toBe(true);
    expect(titleRow.contains(trailing)).toBe(false);
    expect(trailingStrip.contains(trailing)).toBe(true);
    expect(trailing.style.width).toBe('');
    expect(leading.parentElement?.className).toContain('mr-3');
    expect(bindRowSync).toHaveBeenCalledWith('row-1');

    rerender(
      <ListRow
        fields={fields.filter((field) => field.fieldId !== 'leading')}
        reorderable={false}
        rowId='row-1'
        rowOrders={[{ height: 36, id: 'row-1' }]}
      />
    );
    expect(screen.queryByTestId('list-field-leading-row-1')).toBeNull();
  });

  it('database_list_field_display.dart: list view shows visible fields', () => {
    renderRow();

    expect(screen.getByTestId('list-field-leading-row-1')).toBeTruthy();
    expect(screen.getByTestId('list-primary-cell-row-1')).toBeTruthy();
    expect(screen.getByTestId('list-field-interactive-row-1')).toBeTruthy();
  });

  it('list_row.dart: wide rows keep the title at its own width and anchor the trailing strip right', () => {
    renderRow();

    const row = screen.getByTestId('list-row-row-1');
    const content = screen.getByTestId('list-row-content-row-1');
    const titleRow = screen.getByTestId('list-row-title-row-1');
    const trailingStrip = screen.getByTestId('list-row-trailing-row-1');

    expect(row.getAttribute('data-layout')).toBe('wide');
    expect(row.style.minHeight).toBe('36px');
    expect(row.style.containIntrinsicSize).toBe('auto 36px');

    // Desktop: padding spacing.m, radius borderRadius.m, no fixed height.
    expect(content.className).toContain('p-2');
    expect(content.className).toContain('rounded-300');
    expect(content.className).toContain('items-center');
    expect(content.className).not.toContain('flex-col');
    expect(content.className).not.toContain('h-9');
    // The hover fill follows the whole row, gutter included.
    expect(content.className).toContain('group-hover/list-row:bg-fill-content-hover');
    expect(content.className).toContain('group-focus-within/list-row:bg-fill-content-hover');
    expect(content.className).not.toContain(' hover:bg-fill-content-hover');

    expect(titleRow.className).toContain('h-5');
    expect(titleRow.className).toContain('flex-initial');
    expect(titleRow.className).not.toContain('w-full');

    // SingleChildScrollView(reverse: true) with 12px after the title.
    expect(trailingStrip.className).toContain('flex-row-reverse');
    expect(trailingStrip.className).toContain('flex-1');
    expect(trailingStrip.className).toContain('ml-3');
    expect(trailingStrip.className).toContain('overflow-x-auto');
    expect(trailingStrip.className).toContain('overflow-y-hidden');
    expect(trailingStrip.className).toContain('appflowy-hidden-scroller');
    expect(trailingStrip.className).toContain('[scrollbar-width:none]');
    expect(trailingStrip.className).not.toContain('mt-1.5');
    expect(trailingStrip.children).toHaveLength(1);
    expect(trailingStrip.firstElementChild?.className).toContain('h-5');
    expect(trailingStrip.firstElementChild?.className).toContain('shrink-0');

    expect(screen.queryByTestId('list-row-spacer-row-1')).toBeNull();
    expect(screen.getByTestId('list-row-open-row-1').className).toContain('rounded-300');
  });

  it('list_row.dart: narrow rows stack the trailing strip 6px under a full-width title row', () => {
    renderNarrowRow();

    const row = screen.getByTestId('list-row-row-1');
    const content = screen.getByTestId('list-row-content-row-1');
    const titleRow = screen.getByTestId('list-row-title-row-1');
    const trailingStrip = screen.getByTestId('list-row-trailing-row-1');

    expect(row.getAttribute('data-layout')).toBe('narrow');
    expect(row.style.minHeight).toBe('36px');
    expect(row.style.containIntrinsicSize).toBe('auto 62px');

    expect(content.className).toContain('flex-col');
    expect(content.className).toContain('items-start');
    expect(content.className).not.toContain('items-center');

    expect(titleRow.className).toContain('w-full');
    expect(titleRow.className).not.toContain('flex-initial');

    expect(trailingStrip.className).toContain('mt-1.5');
    expect(trailingStrip.className).toContain('max-w-full');
    expect(trailingStrip.className).toContain('overflow-x-auto');
    expect(trailingStrip.className).not.toContain('flex-row-reverse');
    expect(trailingStrip.className).not.toContain('flex-1');
    expect(trailingStrip.className).not.toContain('ml-3');
  });

  it('reserves a single-line placeholder for narrow rows without trailing properties', () => {
    renderNarrowRow(fields.filter((field) => field.fieldId !== 'interactive'));

    expect(screen.queryByTestId('list-row-trailing-row-1')).toBeNull();
    expect(screen.getByTestId('list-row-row-1').style.containIntrinsicSize).toBe('auto 36px');
  });

  it('desktop_list_card_cell_style.dart: property cells are 12/18 text-primary, trailing ones padded 12px left', () => {
    renderRow();

    const leading = screen.getByTestId('list-field-leading-row-1');
    const trailing = screen.getByTestId('list-field-interactive-row-1');

    for (const cell of [leading, trailing]) {
      expect(cell.className).toContain('list-property-cell');
      expect(cell.className).toContain('h-5');
      expect(cell.className).toContain('text-text-primary');
      expect(cell.className).toContain('leading-[18px]');
      expect(cell.className).not.toContain('text-text-secondary');
      expect(cell.className).not.toContain('px-0.5');
    }

    expect(trailing.className).toContain('pl-3');
    expect(trailing.className).toContain('shrink-0');
    expect(leading.className).not.toContain('pl-3');
    expect(leading.getAttribute('data-field-id')).toBe('leading');
  });

  it('opens the row only from a non-interactive surface', () => {
    renderRow();

    fireEvent.click(screen.getByTestId('list-row-row-1'));
    expect(navigateToRow).toHaveBeenCalledWith('row-1');

    navigateToRow.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Cell action' }));
    expect(navigateToRow).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('list-checkbox-cell-row-1-leading'));
    expect(mockUpdateCell).toHaveBeenCalledWith('Yes');
    expect(navigateToRow).not.toHaveBeenCalled();

    // The trailing strip is not an interactive target: its clicks still open the row.
    fireEvent.click(screen.getByTestId('list-row-trailing-row-1'));
    expect(navigateToRow).toHaveBeenCalledWith('row-1');
  });

  it('list_row.dart _PeekButton: a hover-only peek button follows the title and opens the row once', () => {
    renderRow();

    const primary = screen.getByTestId('list-primary-cell-row-1');
    const peek = screen.getByTestId('list-row-peek-row-1');

    expect(screen.getByTestId('list-row-title-row-1').contains(peek)).toBe(true);
    expect(primary.nextElementSibling).toBe(peek);
    expect(peek.className).toContain('hidden');
    expect(peek.className).toContain('group-hover/list-row:flex');
    expect(peek.className).toContain('group-focus-within/list-row:flex');
    expect(peek.className).toContain('ml-1.5');
    expect(peek.getAttribute('aria-label')).toBe('grid.rowPage.openAsSidePeekPanel');

    fireEvent.click(peek);
    expect(navigateToRow).toHaveBeenCalledTimes(1);
    expect(navigateToRow).toHaveBeenCalledWith('row-1');
  });

  it('keeps the peek button in readonly lists (desktop shows it regardless of isEditable)', () => {
    mockUseReadOnly.mockReturnValue(true);
    renderRow();

    expect(screen.getByTestId('list-row-peek-row-1')).toBeTruthy();
  });

  it('exposes a separate keyboard-focusable row opener', () => {
    renderRow();

    const opener = screen.getByRole('button', { name: 'Open row' });

    expect(opener.closest('[data-testid="list-row-row-1"]')).not.toBeNull();
    expect(opener.querySelector('button')).toBeNull();
    opener.focus();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    expect(navigateToRow).toHaveBeenCalledWith('row-1');
  });

  it('suppresses actions in readonly mode while preserving their leading slot', () => {
    mockUseReadOnly.mockReturnValue(true);
    const { container } = renderRow();

    expect(screen.queryByTestId('list-row-actions-row-1')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('database_list_field_display.dart: list view shows row icon and document indicator', () => {
    const { rerender } = render(
      <ListRow fields={fields} reorderable={false} rowId='row-1' rowOrders={[{ height: 36, id: 'row-1' }]} />
    );

    expect(screen.getByTestId('mock-primary-cell').getAttribute('data-placeholder')).toBe('Untitled');

    mockUseRowMetaSelector.mockReturnValue({ icon: '', isEmptyDocument: false } as ReturnType<
      typeof useRowMetaSelector
    >);
    rerender(<ListRow fields={fields} reorderable={false} rowId='row-1' rowOrders={[{ height: 36, id: 'row-1' }]} />);

    expect(screen.getByTestId('mock-primary-cell').getAttribute('data-placeholder')).toBe('');
    expect(screen.getByTestId('list-primary-cell-row-1').getAttribute('data-primary-indicator')).toBe('document');

    // Desktop: doc_s at 20px in iconColorScheme.secondary with a 4px gap.
    const documentIcon = screen.getByTestId('list-primary-cell-row-1').querySelector('svg');

    expect(documentIcon?.getAttribute('class')).toBe('mr-1 h-5 w-5 shrink-0 text-icon-secondary');
    expect(documentIcon?.getAttribute('aria-hidden')).toBe('true');

    mockUseRowMetaSelector.mockReturnValue({ icon: '📌', isEmptyDocument: false } as ReturnType<
      typeof useRowMetaSelector
    >);
    rerender(<ListRow fields={fields} reorderable={false} rowId='row-1' rowOrders={[{ height: 36, id: 'row-1' }]} />);

    expect(screen.getByTestId('list-primary-cell-row-1').getAttribute('data-primary-indicator')).toBe('icon');
    expect(screen.getByText('📌').className).toContain('text-base');
    expect(screen.getByText('📌').className).toContain('leading-4');

    mockUseRowMetaSelector.mockReturnValue({ icon: '🇺🇸', isEmptyDocument: false } as ReturnType<
      typeof useRowMetaSelector
    >);
    rerender(<ListRow fields={fields} reorderable={false} rowId='row-1' rowOrders={[{ height: 36, id: 'row-1' }]} />);
    expect(screen.getByText('🇺🇸').className).toContain('icon');
  });

  it('renders the reactive row comment count beside the title', () => {
    mockUseRowCommentCount.mockReturnValue(3);
    renderRow();

    const primary = screen.getByTestId('list-primary-cell-row-1');
    const comment = screen.getByTestId('list-row-comment-count-row-1');

    expect(comment.textContent).toContain('3');
    expect(primary.children[0]?.nextElementSibling).toBe(comment);
    // The peek button sits after the comment count, as on desktop.
    expect(primary.nextElementSibling).toBe(screen.getByTestId('list-row-peek-row-1'));
  });
});
