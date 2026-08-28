import { fireEvent, render, screen } from '@testing-library/react';

import SelectOptionCellMenu from '@/components/database/components/cell/select-option/SelectOptionCellMenu';
import {
  createGridInteractionStore,
  GridInteractionContext,
} from '@/components/database/grid/useGridContext';

import type { KeyboardEventHandler, ReactNode } from 'react';

const mockUpdateCell = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/application/database-yjs', () => ({
  FieldType: { MultiSelect: 4, SingleSelect: 3 },
  parseSelectOptionTypeOptions: () => ({
    options: [
      { color: 0, id: 'design', name: 'Design' },
      { color: 1, id: 'marketing', name: 'Marketing' },
    ],
  }),
  useFieldSelector: () => ({ clock: 0, field: { get: () => 3 } }),
  useSelectFieldOptions: () => [
    { color: 0, id: 'design', name: 'Design' },
    { color: 1, id: 'marketing', name: 'Marketing' },
  ],
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useAddSelectOption: () => jest.fn(),
  useUpdateCellDispatch: () => mockUpdateCell,
}));

jest.mock('@/components/_shared/tag', () => ({
  Tag: ({ label }: { label: string }) => <span>{label}</span>,
}));

jest.mock('@/components/database/components/cell/select-option/TagsInput', () => ({
  TagsInput: ({
    inputValue,
    onInputChange,
    onKeyDown,
    ...props
  }: {
    inputValue: string;
    onInputChange: (value: string) => void;
    onKeyDown: KeyboardEventHandler<HTMLInputElement>;
    'data-database-history-hotkeys'?: string;
  }) => (
    <input
      data-testid='select-option-search'
      value={inputValue}
      onChange={(event) => onInputChange(event.target.value)}
      onKeyDown={onKeyDown}
      data-database-history-hotkeys={props['data-database-history-hotkeys']}
    />
  ),
}));

jest.mock('@/components/database/components/property/select/Options', () => ({
  __esModule: true,
  default: ({ onSelectOption }: { onSelectOption?: (optionId: string) => void }) => (
    <button onClick={() => onSelectOption?.('marketing')}>Marketing</button>
  ),
}));

jest.mock('@/components/ui/popover', () => ({
  Popover: ({
    children,
    modal,
    onOpenChange,
  }: {
    children: ReactNode;
    modal?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div data-modal={modal ? 'true' : undefined} data-testid='select-option-popover'>
      <button onClick={() => onOpenChange?.(false)} type='button'>
        Dismiss popover
      </button>
      {children}
    </div>
  ),
  PopoverContent: ({
    children,
    'data-database-history-scope': historyScopeId,
    'data-testid': testId,
  }: {
    children: ReactNode;
    'data-database-history-scope'?: string;
    'data-testid'?: string;
  }) => (
    <div data-database-history-scope={historyScopeId} data-testid={testId}>
      {children}
    </div>
  ),
  PopoverTrigger: () => null,
}));

function historyEventInit(redo = false): KeyboardEventInit {
  const modifier = /Mac|iPod|iPhone|iPad/.test(window.navigator.platform) ? { metaKey: true } : { ctrlKey: true };

  return { bubbles: true, cancelable: true, key: 'z', shiftKey: redo, ...modifier };
}

function dispatchHistoryEvent(target: Element, redo = false) {
  const event = new KeyboardEvent('keydown', historyEventInit(redo));

  Object.defineProperty(event, 'which', { value: 90 });
  fireEvent(target, event);
}

describe('SelectOptionCellMenu history hotkeys', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['undo', false],
    ['redo', true],
  ])('lets database %s escape after an option selection', (_name, redo) => {
    render(
      <SelectOptionCellMenu
        fieldId='department'
        onOpenChange={jest.fn()}
        open
        rowId='row-1'
        selectOptionIds={['design']}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Marketing' }));

    const searchInput = screen.getByTestId('select-option-search');
    const onDocumentKeyDown = jest.fn();

    expect(searchInput.getAttribute('data-database-history-hotkeys')).toBe('true');
    document.addEventListener('keydown', onDocumentKeyDown);
    dispatchHistoryEvent(searchInput, redo);
    document.removeEventListener('keydown', onDocumentKeyDown);

    expect(onDocumentKeyDown).toHaveBeenCalledTimes(1);
  });

  it('keeps undo inside the search input while the query is dirty', () => {
    render(
      <SelectOptionCellMenu
        fieldId='department'
        onOpenChange={jest.fn()}
        open
        rowId='row-1'
        selectOptionIds={['design']}
      />
    );

    const searchInput = screen.getByTestId('select-option-search');
    const onDocumentKeyDown = jest.fn();

    fireEvent.change(searchInput, { target: { value: 'Mar' } });
    expect(searchInput.getAttribute('data-database-history-hotkeys')).toBeNull();

    document.addEventListener('keydown', onDocumentKeyDown);
    dispatchHistoryEvent(searchInput);
    document.removeEventListener('keydown', onDocumentKeyDown);

    expect(onDocumentKeyDown).not.toHaveBeenCalled();
  });

  it('restores the owning grid history scope when its modal popup closes', () => {
    const store = createGridInteractionStore();
    const restoreHistoryFocus = jest.fn();
    const onOpenChange = jest.fn();

    render(
      <GridInteractionContext.Provider
        value={{
          historyScopeId: 'grid-history-scope',
          restoreHistoryFocus,
          setActiveCell: store.setActiveCell,
          setHoverRowKey: store.setHoverRowKey,
          store,
        }}
      >
        <SelectOptionCellMenu
          fieldId='department'
          onOpenChange={onOpenChange}
          open
          rowId='row-1'
          selectOptionIds={['design']}
        />
      </GridInteractionContext.Provider>
    );

    expect(screen.getByTestId('select-option-popover').getAttribute('data-modal')).toBe('true');
    expect(screen.getByTestId('select-option-menu').getAttribute('data-database-history-scope')).toBe(
      'grid-history-scope'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss popover' }));

    expect(restoreHistoryFocus).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
