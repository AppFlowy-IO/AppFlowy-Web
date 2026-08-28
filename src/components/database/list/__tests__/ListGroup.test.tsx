import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useDatabaseFields, useReadOnly } from '@/application/database-yjs';
import {
  useClearGroupByFieldDispatch,
  useNewRowDispatch,
  useSetListGroupVisibilityDispatch,
  useToggleListGroupCollapsedDispatch,
} from '@/application/database-yjs/dispatch';

import { ListGroupFooter, ListGroupHeader } from '../ListGroup';
import { getListGroupCellsData } from '../ListRowActions';

jest.mock('@/application/database-yjs', () => ({
  FieldType: { Checkbox: 5, RichText: 0 },
  useDatabaseFields: jest.fn(),
  useReadOnly: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useClearGroupByFieldDispatch: jest.fn(),
  useNewRowDispatch: jest.fn(),
  useSetListGroupVisibilityDispatch: jest.fn(),
  useToggleListGroupCollapsedDispatch: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

jest.mock('@/components/_shared/tag', () => ({
  Tag: ({ label }: { label: string }) => <span>{label}</span>,
}));

jest.mock('@/components/database/components/cell/cell.const', () => ({
  SelectOptionColorMap: {},
  SelectOptionFgColorMap: {},
}));

jest.mock('../ListRowActions', () => ({
  getListGroupCellsData: jest.fn(),
}));

const mockUseDatabaseFields = useDatabaseFields as jest.MockedFunction<typeof useDatabaseFields>;
const mockUseReadOnly = useReadOnly as jest.MockedFunction<typeof useReadOnly>;
const mockUseClearGroupByFieldDispatch = useClearGroupByFieldDispatch as jest.MockedFunction<
  typeof useClearGroupByFieldDispatch
>;
const mockUseNewRowDispatch = useNewRowDispatch as jest.MockedFunction<typeof useNewRowDispatch>;
const mockUseSetListGroupVisibilityDispatch = useSetListGroupVisibilityDispatch as jest.MockedFunction<
  typeof useSetListGroupVisibilityDispatch
>;
const mockUseToggleListGroupCollapsedDispatch = useToggleListGroupCollapsedDispatch as jest.MockedFunction<
  typeof useToggleListGroupCollapsedDispatch
>;
const mockGetListGroupCellsData = getListGroupCellsData as jest.MockedFunction<typeof getListGroupCellsData>;

const group = {
  automaticallyHidden: false,
  collapsed: false,
  hidden: false,
  id: 'todo',
  isDefault: false,
  label: 'To do',
  rows: [{ height: 36, id: 'row-a' }],
  visible: true,
};

describe('ListGroupHeader', () => {
  const toggleCollapsed = jest.fn();
  const setVisibility = jest.fn();
  const clearGrouping = jest.fn();
  const createRow = jest.fn().mockResolvedValue('new-row');

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDatabaseFields.mockReturnValue(undefined);
    mockUseReadOnly.mockReturnValue(false);
    mockUseClearGroupByFieldDispatch.mockReturnValue(clearGrouping);
    mockUseNewRowDispatch.mockReturnValue(createRow);
    mockUseSetListGroupVisibilityDispatch.mockReturnValue(setVisibility);
    mockUseToggleListGroupCollapsedDispatch.mockReturnValue(toggleCollapsed);
    mockGetListGroupCellsData.mockImplementation((_fields, fieldId, groupId) =>
      fieldId ? { [fieldId]: groupId === fieldId ? '' : groupId ?? '' } : undefined
    );
  });

  function renderHeader() {
    return render(
      <ListGroupHeader fieldId='status' fieldName='Status' fieldType={0} group={group} groupConfigId='group-config' />
    );
  }

  it('collapses, hides, and removes a group through List-specific dispatches', async () => {
    renderHeader();

    fireEvent.click(screen.getByTestId('list-group-collapse-toggle'));
    expect(toggleCollapsed).toHaveBeenCalledWith('todo', true);

    const actionsTrigger = screen.getByTestId('list-group-actions');

    actionsTrigger.focus();
    fireEvent.keyDown(actionsTrigger, { code: 'Enter', key: 'Enter' });
    fireEvent.click(await screen.findByTestId('list-hide-group'));
    expect(setVisibility).toHaveBeenCalledWith('todo', false);

    actionsTrigger.focus();
    fireEvent.keyDown(actionsTrigger, { code: 'Enter', key: 'Enter' });
    fireEvent.click(await screen.findByTestId('list-remove-grouping'));
    expect(clearGrouping).toHaveBeenCalled();
  });

  it('hides mutating group actions in readonly mode', () => {
    mockUseReadOnly.mockReturnValue(true);
    renderHeader();

    expect(screen.queryByTestId('list-group-actions')).toBeNull();
    expect(screen.queryByTestId('list-group-new-row')).toBeNull();
    expect(screen.getByTestId('list-group-collapse-toggle')).toBeTruthy();
  });

  it('creates a row from the group header with the grouping value', async () => {
    renderHeader();

    fireEvent.click(screen.getByTestId('list-group-new-row'));

    await waitFor(() =>
      expect(createRow).toHaveBeenCalledWith({
        cellsData: { status: 'todo' },
        openAfterCreate: false,
        tailing: true,
      })
    );
  });

  it('matches Desktop GroupHeader spacing and control geometry', () => {
    renderHeader();

    const header = screen.getByTestId('list-group-header-todo');
    const collapse = screen.getByTestId('list-group-collapse-toggle');
    const count = screen.getByTestId('list-group-row-count');
    const actions = screen.getByTestId('list-group-actions');

    expect(header.className).toContain('h-11');
    expect(collapse.className).toContain('mr-1');
    expect(count.className).toContain('ml-2');
    expect(count.className).toContain('py-px');
    expect(actions.className).toContain('ml-2');
  });
});

describe('ListGroupFooter', () => {
  const createRow = jest.fn().mockResolvedValue('new-row');

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDatabaseFields.mockReturnValue(undefined);
    mockUseNewRowDispatch.mockReturnValue(createRow);
    mockGetListGroupCellsData.mockImplementation((_fields, fieldId, groupId) =>
      fieldId ? { [fieldId]: groupId === fieldId ? '' : groupId ?? '' } : undefined
    );
  });

  it('prefills named groups and explicitly clears the default group', async () => {
    const { rerender } = render(<ListGroupFooter fieldId='status' groupId='todo' />);

    fireEvent.click(screen.getByTestId('list-group-footer-todo').querySelector('button') as HTMLButtonElement);
    await waitFor(() =>
      expect(createRow).toHaveBeenCalledWith({
        cellsData: { status: 'todo' },
        openAfterCreate: false,
        tailing: true,
      })
    );

    createRow.mockClear();
    rerender(<ListGroupFooter fieldId='status' groupId='status' />);
    fireEvent.click(screen.getByTestId('list-group-footer-status').querySelector('button') as HTMLButtonElement);

    await waitFor(() =>
      expect(createRow).toHaveBeenCalledWith({
        cellsData: { status: '' },
        openAfterCreate: false,
        tailing: true,
      })
    );
  });

  it('matches Desktop 36px grouped footer geometry', () => {
    render(<ListGroupFooter fieldId='status' groupId='todo' />);

    expect(screen.getByTestId('list-group-footer-todo').className).toContain('h-9');
  });
});
