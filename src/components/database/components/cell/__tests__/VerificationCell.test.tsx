import { render, screen } from '@testing-library/react';

import { createFieldWithTypeOption } from '@/application/database-yjs/__tests__/test-helpers';
import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { useFieldSelector } from '@/application/database-yjs/selector';

import { Cell } from '../Cell';

jest.mock('@/application/database-yjs/selector', () => ({
  ...jest.requireActual('@/application/database-yjs/selector'),
  useFieldSelector: jest.fn(),
}));
jest.mock('@/application/database-yjs/context', () => ({
  ...jest.requireActual('@/application/database-yjs/context'),
  useDatabaseContextOptional: jest.fn(),
}));
jest.mock('@/components/page-verification/PageVerificationControl', () => ({
  PageVerificationControl: ({ expectedPropertyId }: { expectedPropertyId: string }) => (
    <div data-testid='verification-control'>{expectedPropertyId}</div>
  ),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const field = createFieldWithTypeOption('native-id', FieldType.Verification, { property_id: 'generation-a' });

beforeEach(() => {
  jest.mocked(useFieldSelector).mockReturnValue({ field, clock: 0 } as ReturnType<typeof useFieldSelector>);
  jest.mocked(useDatabaseContextOptional).mockReturnValue(undefined);
});
it('renders native type20 with its captured property generation and ordinary native ID', () => {
  render(<Cell rowId='row' fieldId='native-id' />);
  expect(screen.getByTestId('verification-control').textContent).toBe('generation-a');
});
it.each([{ templateEditingRowId: 'row' }, { dataSource: { type: 'history', id: 'snapshot' } }])(
  'does not mount live Cloud claims for %j',
  (context) => {
    jest.mocked(useDatabaseContextOptional).mockReturnValue(context as ReturnType<typeof useDatabaseContextOptional>);
    render(<Cell rowId='row' fieldId='native-id' />);
    expect(screen.queryByTestId('verification-control')).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  }
);
it('does not mount Cloud claims for an unbound native field', () => {
  jest
    .mocked(useFieldSelector)
    .mockReturnValue({
      field: createFieldWithTypeOption('native-id', FieldType.Verification, {}),
      clock: 0,
    } as ReturnType<typeof useFieldSelector>);
  render(<Cell rowId='row' fieldId='native-id' />);
  expect(screen.queryByTestId('verification-control')).toBeNull();
});
