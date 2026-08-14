import { fireEvent, render, screen } from '@testing-library/react';

import {
  useDatabaseContext,
  useIsRowLoaded,
  useReadOnly,
  useRowCommentCount,
  useRowMetaSelector,
} from '@/application/database-yjs';
import type { Column } from '@/application/database-yjs';

import { ListRow } from '../ListRow';

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

jest.mock('../ListRowActions', () => ({
  ListRowActions: ({ rowId }: { rowId: string }) => (
    <button data-testid={`list-row-actions-${rowId}`} type='button'>
      Actions
    </button>
  ),
}));

const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
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
    mockUseIsRowLoaded.mockReturnValue(true);
    mockUseReadOnly.mockReturnValue(false);
    mockUseRowCommentCount.mockReturnValue(0);
    mockUseRowMetaSelector.mockReturnValue(undefined);
  });

  function renderRow() {
    return render(
      <ListRow fields={fields} reorderable={false} rowId='row-1' rowOrders={[{ height: 36, id: 'row-1' }]} />
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

    rerender(<ListRow fields={fields} reorderable={false} rowId='row-1' rowOrders={[{ height: 36, id: 'row-1' }]} />);

    leading = screen.getByTestId('list-field-leading-row-1');
    primary = screen.getByTestId('list-primary-cell-row-1');
    const trailing = screen.getByTestId('list-field-interactive-row-1');
    const spacer = screen.getByTestId('list-row-spacer-row-1');

    expect(leading.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(primary.compareDocumentPosition(trailing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(primary.nextElementSibling).toBe(spacer);
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
  });
});
