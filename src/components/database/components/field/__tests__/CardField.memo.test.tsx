import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';

import CardField from '../CardField';

const mockCellRenders = jest.fn();
// A rich text field (`ty` 0) that is not the primary one.
const mockField = { get: (key: string) => (key === 'ty' ? 0 : undefined) };
const mockCell = { data: 'Engineering' };

jest.mock('@/application/database-yjs', () => ({
  FieldType: { Checkbox: 5, Media: 14, LastEditedTime: 8, CreatedTime: 9, CreatedBy: 13, LastEditedBy: 12 },
  useCellSelector: () => mockCell,
  useFieldSelector: () => ({ field: mockField, clock: 0 }),
  useReadOnly: () => true,
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateCellDispatch: () => jest.fn(),
}));

jest.mock('@/components/database/components/cell/Cell', () => ({
  Cell: ({ cell }: { cell?: { data: string } }) => {
    mockCellRenders();
    return <span>{cell?.data}</span>;
  },
}));

jest.mock('@/components/database/components/cell/primary', () => ({
  PrimaryCell: () => null,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('CardField', () => {
  it('renders again only when its own props change, not with every render of its card', () => {
    let rerenderCard: () => void = () => undefined;
    let startEditing: () => void = () => undefined;
    const setEditing = jest.fn();

    function Card() {
      const [, setRenders] = useState(0);
      const [editing, setEditingState] = useState(false);

      rerenderCard = () => setRenders((renders) => renders + 1);
      startEditing = () => setEditingState(true);
      return <CardField editing={editing} fieldId='department' rowId='row-1' setEditing={setEditing} />;
    }

    render(<Card />);
    expect(screen.getByText('Engineering')).toBeTruthy();
    const firstRenders = mockCellRenders.mock.calls.length;

    act(() => rerenderCard());
    expect(mockCellRenders).toHaveBeenCalledTimes(firstRenders);

    act(() => startEditing());
    expect(mockCellRenders.mock.calls.length).toBeGreaterThan(firstRenders);
  });
});
