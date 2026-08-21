import { FieldType, FieldVisibility } from '@/application/database-yjs';
import type { Column, Row } from '@/application/database-yjs';

import {
  getListLeadingFieldMinWidth,
  getListRemainingRowCount,
  getVisibleListRows,
  isListRowInteractiveTarget,
  resolveListPrimaryIndicator,
  splitListFields,
} from '../list.utils';

function column(fieldId: string, options: Partial<Column> = {}): Column {
  return {
    fieldId,
    fieldType: FieldType.RichText,
    isPrimary: false,
    visibility: FieldVisibility.AlwaysShown,
    width: 140,
    ...options,
  };
}

describe('List field layout', () => {
  it('keeps persisted fields before primary on the leading side and trailing fields in order', () => {
    const fields = [
      column('done', { fieldType: FieldType.Checkbox }),
      column('status', { fieldType: FieldType.SingleSelect }),
      column('title', { isPrimary: true }),
      column('date', { fieldType: FieldType.DateTime }),
      column('owner', { fieldType: FieldType.Person }),
    ];

    const result = splitListFields(fields);

    expect(result.primary?.fieldId).toBe('title');
    expect(result.leading.map((field) => field.fieldId)).toEqual(['done', 'status']);
    expect(result.trailing.map((field) => field.fieldId)).toEqual(['date', 'owner']);
  });

  it('omits the grouping property without changing the remaining relative order', () => {
    const fields = [
      column('done'),
      column('title', { isPrimary: true }),
      column('status', { fieldType: FieldType.SingleSelect }),
      column('owner'),
    ];

    const result = splitListFields(fields, 'status');

    expect(result.leading.map((field) => field.fieldId)).toEqual(['done']);
    expect(result.trailing.map((field) => field.fieldId)).toEqual(['owner']);
  });

  it('uses Desktop minimum widths for compact leading controls', () => {
    expect(getListLeadingFieldMinWidth(FieldType.Checkbox)).toBe(20);
    expect(getListLeadingFieldMinWidth(FieldType.SingleSelect)).toBe(60);
    expect(getListLeadingFieldMinWidth(FieldType.MultiSelect)).toBe(60);
    expect(getListLeadingFieldMinWidth(FieldType.RichText)).toBeUndefined();
  });
});

describe('List incremental rendering', () => {
  const rows = Array.from({ length: 100 }, (_, index): Row => ({ id: `row-${index + 1}`, height: 36 }));

  it('renders the first batch and reports the remaining row count', () => {
    expect(getVisibleListRows(rows, 50)?.map((row) => row.id)).toHaveLength(50);
    expect(getVisibleListRows(rows, 50)?.at(-1)?.id).toBe('row-50');
    expect(getListRemainingRowCount(rows, 50)).toBe(50);
    expect(getListRemainingRowCount(rows, 100)).toBe(0);
  });
});

describe('List primary metadata', () => {
  it('prioritizes an icon over a document and otherwise falls back to Untitled', () => {
    expect(resolveListPrimaryIndicator({ icon: '📌', isEmptyDocument: false })).toBe('icon');
    expect(resolveListPrimaryIndicator({ icon: '', isEmptyDocument: false })).toBe('document');
    expect(resolveListPrimaryIndicator({ icon: '', isEmptyDocument: true })).toBe('none');
    expect(resolveListPrimaryIndicator(undefined)).toBe('none');
  });
});

describe('List row interaction boundary', () => {
  it('treats controls and editable descendants as interactive, but not the row surface', () => {
    const row = document.createElement('div');
    const surface = document.createElement('span');
    const button = document.createElement('button');
    const customControl = document.createElement('div');

    customControl.dataset.listInteractive = 'true';
    row.append(surface, button, customControl);

    expect(isListRowInteractiveTarget(surface)).toBe(false);
    expect(isListRowInteractiveTarget(button)).toBe(true);
    expect(isListRowInteractiveTarget(customControl)).toBe(true);
  });
});
