import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

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

const mockCardFieldRenders = jest.fn();

jest.mock('@/components/database/components/field/CardField', () => ({
  __esModule: true,
  default: ({ editing }: { editing?: boolean }) => {
    mockCardFieldRenders();
    return editing ? <textarea aria-label='card title' /> : <span>Card title</span>;
  },
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

  it('renders its fields again only when its own props change, not with every render of its card', () => {
    let rerenderCard: () => void = () => undefined;
    let moveCard: () => void = () => undefined;

    function Card() {
      const [, setRenders] = useState(0);
      const [rowId, setRowId] = useState('row-1');

      rerenderCard = () => setRenders((renders) => renders + 1);
      moveCard = () => setRowId('row-2');
      return <CardPrimitive columnId='todo' groupFieldId='status-field' rowId={rowId} />;
    }

    render(<Card />);
    const firstRenders = mockCardFieldRenders.mock.calls.length;

    expect(firstRenders).toBeGreaterThan(0);
    // The board's drag context or column changed: the card renders, its body does not.
    act(() => rerenderCard());
    expect(mockCardFieldRenders).toHaveBeenCalledTimes(firstRenders);

    act(() => moveCard());
    expect(mockCardFieldRenders.mock.calls.length).toBeGreaterThan(firstRenders);
  });

  it('opens a card title inside a non-editable board embedded in an editable document', () => {
    mockUseBoardSelection.mockReturnValue({
      editingCardId: null,
      selectedCardIds: [],
    } as ReturnType<typeof useBoardSelection>);

    render(
      <div contentEditable suppressContentEditableWarning>
        <div contentEditable={false}>
          <CardPrimitive columnId='todo' groupFieldId='status-field' rowId='row-1' />
        </div>
      </div>
    );

    fireEvent.click(screen.getByText('Card title'));

    expect(navigateToRow).toHaveBeenCalledWith('row-1');
  });

  it('keeps the embedded title editor interactive while allowing clicks on the card surface', () => {
    const { container } = render(
      <div contentEditable suppressContentEditableWarning>
        <div contentEditable={false}>
          <CardPrimitive columnId='todo' groupFieldId='status-field' rowId='row-1' />
        </div>
      </div>
    );

    fireEvent.click(screen.getByRole('textbox', { name: 'card title' }));
    expect(navigateToRow).not.toHaveBeenCalled();
    expect(setEditingCardId).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector('[data-card-id="todo/row-1"]') as Element);
    expect(setEditingCardId).toHaveBeenCalledWith(null);
    expect(navigateToRow).toHaveBeenCalledWith('row-1');
  });
});
