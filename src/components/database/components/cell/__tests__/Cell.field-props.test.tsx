import { render } from '@testing-library/react';
import * as Y from 'yjs';

import type { Cell as CellType, CellProps } from '@/application/database-yjs/cell.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';
import { Cell } from '@/components/database/components/cell/Cell';
import { Property } from '@/components/database/components/property/Property';

const mockTextCell = jest.fn();
let mockField: YDatabaseField | undefined;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/database-yjs/context', () => ({
  ...jest.requireActual('@/application/database-yjs/context'),
  useDatabaseContextOptional: () => undefined,
}));
jest.mock('@/application/database-yjs/selector', () => ({
  ...jest.requireActual('@/application/database-yjs/selector'),
  useCellSelector: () => undefined,
  useFieldSelector: () => ({ field: mockField }),
}));
jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs'),
  useCellSelector: () => undefined,
  useFieldSelector: () => ({ field: mockField }),
  useReadOnly: () => false,
}));
jest.mock('@/components/database/components/property/PropertyWrapper', () => ({
  __esModule: true,
  default: ({ children }: { children: JSX.Element }) => children,
}));
// Only what reaches the Text cell matters here.
jest.mock('@/components/database/components/cell/text', () => ({
  TextCell: (props: CellProps<CellType>) => {
    mockTextCell(props);
    return null;
  },
}));

function makeField(type: FieldType, name: string) {
  const field = new Y.Doc().getMap('field') as YDatabaseField;

  field.set(YjsDatabaseKey.type, type);
  field.set(YjsDatabaseKey.name, name);
  return field;
}

describe('the field a Text cell is rendered for', () => {
  beforeEach(() => {
    mockTextCell.mockReset();
  });

  // The Text cell does not observe its field: an empty URL cell has no cell
  // to read a type from, so its renderer must pass the field's type.
  it.each([
    ['a grid or card cell', () => <Cell rowId='row' fieldId='field' wrap={false} />],
    ['a row page property', () => <Property rowId='row' fieldId='field' />],
  ])('reaches %s without a cell', (_name, element) => {
    mockField = makeField(FieldType.URL, 'Website');
    render(element());

    const [props] = mockTextCell.mock.calls[0] as [CellProps<CellType>];

    expect(props.cell).toBeUndefined();
    expect(props).toMatchObject({ fieldType: FieldType.URL, fieldName: 'Website' });
  });

  it('is left undefined while the field itself is unknown', () => {
    mockField = undefined;
    render(<Cell rowId='row' fieldId='field' wrap={false} />);

    expect(mockTextCell).toHaveBeenCalledWith(expect.objectContaining({ fieldType: undefined, fieldName: undefined }));
  });
});
