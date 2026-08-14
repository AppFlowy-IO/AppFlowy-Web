import { fireEvent, render, screen } from '@testing-library/react';

import {
  FieldType,
  parseChecklistFlexible,
  parseSelectOptionTypeOptions,
  useFieldSelector,
  useReadOnly,
} from '@/application/database-yjs';
import type { Column } from '@/application/database-yjs';
import type { Cell as DatabaseCell } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';

import { formatListTime, ListCell } from '../ListCell';

jest.mock('@/application/database-yjs', () => ({
  FieldType: {
    RichText: 0,
    Number: 1,
    DateTime: 2,
    SingleSelect: 3,
    MultiSelect: 4,
    Checkbox: 5,
    URL: 6,
    Checklist: 7,
    LastEditedTime: 8,
    CreatedTime: 9,
    Relation: 10,
    Summary: 11,
    Translate: 12,
    Time: 13,
    Media: 14,
    Person: 15,
    Rollup: 16,
  },
  SelectOptionColor: { OptionColor1: 'OptionColor1' },
  parseChecklistFlexible: jest.fn(),
  parseSelectOptionTypeOptions: jest.fn(),
  useFieldSelector: jest.fn(),
  useReadOnly: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateCellDispatch: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'grid.media.attachmentsHint' ? '{} attachments' : key),
  }),
}));

jest.mock('@/components/database/components/cell/Cell', () => ({
  Cell: ({ fieldId }: { fieldId: string }) => <span data-testid={`shared-cell-${fieldId}`} />,
}));

const mockParseSelectOptionTypeOptions = parseSelectOptionTypeOptions as jest.MockedFunction<
  typeof parseSelectOptionTypeOptions
>;
const mockParseChecklistFlexible = parseChecklistFlexible as jest.MockedFunction<typeof parseChecklistFlexible>;
const mockUseFieldSelector = useFieldSelector as jest.MockedFunction<typeof useFieldSelector>;
const mockUseReadOnly = useReadOnly as jest.MockedFunction<typeof useReadOnly>;
const mockUseUpdateCellDispatch = useUpdateCellDispatch as jest.MockedFunction<typeof useUpdateCellDispatch>;

function makeField(fieldId: string, fieldType: FieldType): Column {
  return { fieldId, fieldType, isPrimary: false, visibility: 0, width: 140 } as Column;
}

function makeCell(fieldType: FieldType, data: unknown): DatabaseCell {
  return { createdAt: 0, data, fieldType, lastModified: 0 };
}

describe('database_list_field_display.dart: list view displays multiple field types correctly', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFieldSelector.mockReturnValue({ clock: 0, field: {} } as ReturnType<typeof useFieldSelector>);
    mockUseReadOnly.mockReturnValue(false);
    mockUseUpdateCellDispatch.mockReturnValue(jest.fn());
    mockParseSelectOptionTypeOptions.mockReturnValue({
      options: [{ color: 'OptionColor1', id: 'todo', name: 'Todo' }],
    } as ReturnType<typeof parseSelectOptionTypeOptions>);
  });

  it('renders and toggles the Flutter 14px checkbox in a stable 20px slot', () => {
    const updateCell = jest.fn();

    mockUseUpdateCellDispatch.mockReturnValue(updateCell);
    render(
      <ListCell
        cell={makeCell(FieldType.Checkbox, 'Yes')}
        field={makeField('done', FieldType.Checkbox)}
        rowId='row-1'
        style={{}}
      />
    );

    const checkbox = screen.getByTestId('list-checkbox-cell-row-1-done');

    expect(checkbox.className).toContain('w-5');
    expect(checkbox.className).toContain('justify-center');
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(checkbox.querySelector('svg')?.getAttribute('class')).toContain('h-3.5');

    fireEvent.click(checkbox);
    expect(updateCell).toHaveBeenCalledWith('No');
  });

  it('keeps the compact checkbox non-mutating in readonly Lists', () => {
    const updateCell = jest.fn();

    mockUseReadOnly.mockReturnValue(true);
    mockUseUpdateCellDispatch.mockReturnValue(updateCell);
    render(
      <ListCell
        cell={makeCell(FieldType.Checkbox, 'No')}
        field={makeField('done', FieldType.Checkbox)}
        rowId='row-1'
        style={{}}
      />
    );

    const checkbox = screen.getByTestId('list-checkbox-cell-row-1-done');

    expect(checkbox.hasAttribute('disabled')).toBe(true);
    fireEvent.click(checkbox);
    expect(updateCell).not.toHaveBeenCalled();
  });

  it.each([
    ['SingleSelect', FieldType.SingleSelect],
    ['MultiSelect', FieldType.MultiSelect],
  ] as const)('renders Flutter compact tags for %s fields', (_name, fieldType) => {
    render(
      <ListCell cell={makeCell(fieldType, 'todo')} field={makeField('status', fieldType)} rowId='row-1' style={{}} />
    );

    const tag = screen.getByTestId('list-select-option-tag');

    expect(tag.textContent).toBe('Todo');
    expect(tag.className).toContain('text-[11px]');
    expect(tag.className).toContain('px-1.5');
    expect(tag.getAttribute('data-background-color-token')).toBe('--tag-fill-01-light');
  });

  it('renders Flutter media summary metadata instead of Grid image previews', () => {
    render(
      <ListCell
        cell={makeCell(FieldType.Media, [{ id: 'one' }, { id: 'two' }])}
        field={makeField('media', FieldType.Media)}
        rowId='row-1'
        style={{}}
      />
    );

    const media = screen.getByTestId('list-media-cell-row-1-media');

    expect(media.textContent).toBe('2 attachments');
    expect(media.className).toContain('px-1');
    expect(media.querySelector('img')).toBeNull();
    expect(media.querySelector('svg')?.getAttribute('class')).toContain('h-3');
  });

  it('renders Flutter TimeCardCell duration text', () => {
    render(
      <ListCell
        cell={makeCell(FieldType.Time, '135')}
        field={makeField('duration', FieldType.Time)}
        rowId='row-1'
        style={{}}
      />
    );

    expect(screen.getByTestId('list-time-cell-row-1-duration').textContent).toBe('2h 15m');
  });

  it('renders Flutter checklist geometry as an 80px bar plus 45px percentage', () => {
    mockParseChecklistFlexible.mockReturnValue({
      options: [
        { color: 'OptionColor1', id: 'one', name: 'One' },
        { color: 'OptionColor1', id: 'two', name: 'Two' },
      ],
      percentage: 0.5,
      selectedOptionIds: ['two'],
    } as ReturnType<typeof parseChecklistFlexible>);

    render(
      <ListCell
        cell={makeCell(FieldType.Checklist, '[x] One\n[ ] Two')}
        field={makeField('tasks', FieldType.Checklist)}
        rowId='row-1'
        style={{}}
      />
    );

    const checklist = screen.getByTestId('list-checklist-cell-row-1-tasks');

    expect(checklist.firstElementChild?.className).toContain('w-20');
    expect(checklist.lastElementChild?.className).toContain('w-[45px]');
    expect(checklist.textContent).toBe('50%');
    expect(checklist.firstElementChild?.children[0].getAttribute('data-background-color-token')).toBe(
      '--fill-theme-thick'
    );
    expect(checklist.firstElementChild?.children[1].getAttribute('data-background-color-token')).toBe(
      '--fill-info-light'
    );
  });

  it.each([
    ['RichText', FieldType.RichText],
    ['Number', FieldType.Number],
    ['DateTime', FieldType.DateTime],
    ['URL', FieldType.URL],
    ['LastEditedTime', FieldType.LastEditedTime],
    ['CreatedTime', FieldType.CreatedTime],
    ['Relation', FieldType.Relation],
    ['Summary', FieldType.Summary],
    ['Translate', FieldType.Translate],
    ['Person', FieldType.Person],
    ['Rollup', FieldType.Rollup],
  ] as const)('routes Flutter %s fields through the shared cell renderer', (_name, fieldType) => {
    const fieldId = `field-${fieldType}`;

    render(
      <ListCell cell={makeCell(fieldType, 'Value')} field={makeField(fieldId, fieldType)} rowId='row-1' style={{}} />
    );

    expect(screen.getByTestId(`shared-cell-${fieldId}`)).toBeTruthy();
  });

  it.each([
    [
      'Person',
      FieldType.Person,
      [
        '[&_.select-option-cell]:!gap-0',
        '[&_.select-option-cell>div>div]:!gap-1.5',
        '[&_.select-option-cell>div>div>span]:!text-xs',
      ],
    ],
    ['Relation', FieldType.Relation, ['[&_.relation-cell]:!gap-0', '[&_.relation-cell>div]:!text-text-secondary']],
    ['Rollup', FieldType.Rollup, ['[&_.rollup-cell>div>div]:!bg-fill-secondary']],
  ] as const)('scopes Flutter compact %s styling without changing Grid', (_name, fieldType, classes) => {
    const fieldId = `field-${fieldType}`;

    render(
      <ListCell cell={makeCell(fieldType, 'Value')} field={makeField(fieldId, fieldType)} rowId='row-1' style={{}} />
    );

    const wrapper = screen.getByTestId(`list-shared-cell-row-1-${fieldId}`);

    classes.forEach((className) => expect(wrapper.className).toContain(className));
  });
});

describe('formatListTime', () => {
  it.each([
    [0, '0m'],
    [5, '5m'],
    [60, '1h'],
    [75, '1h 15m'],
    ['120', '2h'],
    [-1, ''],
    ['not-a-time', ''],
  ])('matches Flutter formatTime for %p', (value, expected) => {
    expect(formatListTime(value)).toBe(expected);
  });
});
