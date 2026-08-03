import { fireEvent, render, screen } from '@testing-library/react';

import { useDatabaseContext, useFieldsSelector, useReadOnly, useRowMetaSelector } from '@/application/database-yjs';
import { useBoardActions, useBoardSelection } from '@/components/database/board/BoardProvider';

import { CardPrimitive } from '../CardPrimitive';

jest.mock('@/application/database-yjs', () => ({
  FieldVisibility: { AlwaysHidden: 2 },
  isAIFieldType: () => false,
  useDatabaseContext: jest.fn(),
  useFieldsSelector: jest.fn(),
  useReadOnly: jest.fn(),
  useRowMetaSelector: jest.fn(),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => false,
}));

jest.mock('@/components/database/board/BoardProvider', () => ({
  useBoardActions: jest.fn(),
  useBoardSelection: jest.fn(),
}));

jest.mock('@/components/database/components/field/CardField', () => ({
  __esModule: true,
  default: ({ editing }: { editing?: boolean }) =>
    editing ? <textarea aria-label='card title' /> : <span>Card title</span>,
}));

jest.mock('@/components/database/components/board/card/CardToolbar', () => ({
  __esModule: true,
  default: () => null,
}));

const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
const mockUseFieldsSelector = useFieldsSelector as jest.MockedFunction<typeof useFieldsSelector>;
const mockUseReadOnly = useReadOnly as jest.MockedFunction<typeof useReadOnly>;
const mockUseRowMetaSelector = useRowMetaSelector as jest.MockedFunction<typeof useRowMetaSelector>;
const mockUseBoardActions = useBoardActions as jest.MockedFunction<typeof useBoardActions>;
const mockUseBoardSelection = useBoardSelection as jest.MockedFunction<typeof useBoardSelection>;

describe('CardPrimitive', () => {
  const navigateToRow = jest.fn();
  const setEditingCardId = jest.fn();
  const setSelectedCardIds = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({ navigateToRow } as ReturnType<typeof useDatabaseContext>);
    mockUseFieldsSelector.mockReturnValue([
      {
        fieldId: 'title-field',
        fieldType: 0,
        visibility: 0,
      },
    ] as ReturnType<typeof useFieldsSelector>);
    mockUseReadOnly.mockReturnValue(false);
    mockUseRowMetaSelector.mockReturnValue(undefined);
    mockUseBoardActions.mockReturnValue({
      setEditingCardId,
      setSelectedCardIds,
    } as ReturnType<typeof useBoardActions>);
    mockUseBoardSelection.mockReturnValue({
      editingCardId: 'todo/row-1',
      selectedCardIds: [],
    } as ReturnType<typeof useBoardSelection>);
  });

  it('opens an editing card when its non-interactive surface is clicked', () => {
    const { container } = render(<CardPrimitive columnId='todo' groupFieldId='status-field' rowId='row-1' />);
    const card = container.querySelector('[data-card-id="todo/row-1"]');

    expect(card).not.toBeNull();
    fireEvent.click(card as Element);

    expect(setEditingCardId).toHaveBeenCalledWith(null);
    expect(setSelectedCardIds).toHaveBeenCalledWith(['todo/row-1']);
    expect(navigateToRow).toHaveBeenCalledWith('row-1');
  });

  it('keeps clicks inside the title editor from opening the row', () => {
    render(<CardPrimitive columnId='todo' groupFieldId='status-field' rowId='row-1' />);

    fireEvent.click(screen.getByRole('textbox', { name: 'card title' }));

    expect(setEditingCardId).not.toHaveBeenCalled();
    expect(navigateToRow).not.toHaveBeenCalled();
  });
});
