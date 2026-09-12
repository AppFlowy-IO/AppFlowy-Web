import { act, fireEvent, render, screen } from '@testing-library/react';

import RelationCellMenu from '../RelationCellMenu';

import type { ReactNode } from 'react';

const mockContext = { templateEditingRowId: undefined as string | undefined };
const mockUpdateRelationCell = jest.fn();
const mockRelationData = {
  loading: false,
  relations: { 'related-database': 'related-view' },
  selectedView: { view_id: 'related-view', name: 'Related tasks' },
  setSelectedView: jest.fn(),
  onUpdateDatabaseId: jest.fn(),
  views: [{ view_id: 'related-view', name: 'Related tasks' }],
  relatedDatabaseId: '' as string,
};

jest.mock('@/application/database-yjs/context', () => ({
  useDatabaseContext: () => mockContext,
}));

jest.mock('@/application/database-yjs/dispatch/relation', () => ({
  useUpdateRelationCell: () => mockUpdateRelationCell,
}));

jest.mock('@/components/database/components/property/relation/useRelationData', () => ({
  useRelationData: () => mockRelationData,
}));

jest.mock('@/components/database/components/cell/relation/NoDatabaseSelectedContent', () => ({
  __esModule: true,
  default: ({ onSelect }: { onSelect: (view: { view_id: string }) => void }) => (
    <button onClick={() => onSelect({ view_id: 'related-view' })}>Configure related database</button>
  ),
}));

jest.mock('@/components/database/components/cell/relation/RelationCellMenuContent', () => ({
  __esModule: true,
  default: ({ onAddRelationRowId }: { onAddRelationRowId: (id: string) => void }) => (
    <button onClick={() => onAddRelationRowId('existing-task')}>Existing task</button>
  ),
}));

jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: () => null,
}));

describe('RelationCellMenu isolated editing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockContext.templateEditingRowId = 'draft-row';
    mockRelationData.relatedDatabaseId = '';
  });

  afterEach(() => jest.useRealTimers());

  function openMenu() {
    render(<RelationCellMenu open rowId='draft-row' fieldId='relation-field' />);
    act(() => {
      jest.advanceTimersByTime(100);
    });
  }

  it('blocks target schema configuration until the isolated row is saved', () => {
    openMenu();
    const configure = screen.getByRole('button', { name: 'Configure related database' });

    expect(configure.closest('fieldset')?.disabled).toBe(true);
    fireEvent.click(configure);
    expect(mockRelationData.setSelectedView).not.toHaveBeenCalled();
    expect(mockRelationData.onUpdateDatabaseId).not.toHaveBeenCalled();
  });

  it('keeps configured relations editable through the row cell dispatcher', () => {
    mockRelationData.relatedDatabaseId = 'related-database';
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Existing task' }));

    expect(mockUpdateRelationCell).toHaveBeenCalledWith({ insertedRowIds: ['existing-task'] });
    expect(mockRelationData.onUpdateDatabaseId).not.toHaveBeenCalled();
  });

  it('preserves target schema configuration for persisted rows', () => {
    mockContext.templateEditingRowId = undefined;
    openMenu();
    const configure = screen.getByRole('button', { name: 'Configure related database' });

    expect(configure.closest('fieldset')?.disabled).toBe(false);
    fireEvent.click(configure);
    expect(mockRelationData.setSelectedView).toHaveBeenCalledWith({ view_id: 'related-view' });
    expect(mockRelationData.onUpdateDatabaseId).toHaveBeenCalledWith('related-database');
  });
});
