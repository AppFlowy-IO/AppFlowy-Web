import { render, screen } from '@testing-library/react';

import { FieldType, parseSelectOptionTypeOptions, useFieldSelector } from '@/application/database-yjs';
import type { Column } from '@/application/database-yjs';
import type { Cell as DatabaseCell } from '@/application/database-yjs/cell.type';

import { ListCell } from '../ListCell';

jest.mock('@/application/database-yjs', () => ({
  FieldType: { Checkbox: 5, Media: 11, MultiSelect: 4, RichText: 0, SingleSelect: 3 },
  SelectOptionColor: { OptionColor1: 'OptionColor1' },
  parseSelectOptionTypeOptions: jest.fn(),
  useFieldSelector: jest.fn(),
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
const mockUseFieldSelector = useFieldSelector as jest.MockedFunction<typeof useFieldSelector>;

function makeField(fieldId: string, fieldType: FieldType): Column {
  return { fieldId, fieldType, isPrimary: false, visibility: 0, width: 140 } as Column;
}

function makeCell(fieldType: FieldType, data: unknown): DatabaseCell {
  return { createdAt: 0, data, fieldType, lastModified: 0 };
}

describe('ListCell Desktop compact styles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFieldSelector.mockReturnValue({ clock: 0, field: {} } as ReturnType<typeof useFieldSelector>);
    mockParseSelectOptionTypeOptions.mockReturnValue({
      options: [{ color: 'OptionColor1', id: 'todo', name: 'Todo' }],
    } as ReturnType<typeof parseSelectOptionTypeOptions>);
  });

  it('renders a checkbox with the Flutter 14px icon in a stable 20px slot', () => {
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
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(checkbox.querySelector('svg')?.getAttribute('class')).toContain('h-3.5');
  });

  it('renders compact 11px select tags with six-pixel horizontal padding', () => {
    render(
      <ListCell
        cell={makeCell(FieldType.SingleSelect, 'todo')}
        field={makeField('status', FieldType.SingleSelect)}
        rowId='row-1'
        style={{}}
      />
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

  it('keeps all other field types on the shared renderer', () => {
    render(
      <ListCell
        cell={makeCell(FieldType.RichText, 'Notes')}
        field={makeField('notes', FieldType.RichText)}
        rowId='row-1'
        style={{}}
      />
    );

    expect(screen.getByTestId('shared-cell-notes')).toBeTruthy();
  });
});
