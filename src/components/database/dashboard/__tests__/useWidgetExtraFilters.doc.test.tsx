import { renderHook } from '@testing-library/react';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';

import { createSourceDoc, option } from '../global-filters/__tests__/source-doc.fixture';
import { useWidgetExtraFilters } from '../hooks/useWidgetExtraFilters';

/** Picked in another database (`a-*` ids); this widget's database calls its options `b-*`. */
const SELECT_FILTER: DashboardGlobalFilter = {
  id: 'gf-status',
  name: 'Status',
  fieldType: FieldType.SingleSelect,
  condition: 0,
  content: 'a-done',
  optionNames: ['Done'],
  targets: { db1: 'status' },
};

function sourceDoc() {
  return createSourceDoc('db1', [
    {
      id: 'status',
      name: 'Status',
      type: FieldType.SingleSelect,
      options: [option('b-todo', 'Todo'), option('b-done', 'Done')],
    },
  ]);
}

describe('useWidgetExtraFilters with the widget doc', () => {
  it('matches a select filter by option name against the doc it is given', () => {
    const doc = sourceDoc();
    const { result } = renderHook(() => useWidgetExtraFilters([SELECT_FILTER], 'db1', doc));

    expect(result.current?.map((filter) => [filter.field_id, filter.content])).toEqual([['status', 'b-done']]);
    doc.destroy();
  });

  it('keeps the stored ids while the widget has no doc', () => {
    const { result } = renderHook(() => useWidgetExtraFilters([SELECT_FILTER], 'db1', null));

    expect(result.current?.[0].content).toBe('a-done');
  });

  it('ignores a doc of the widget database while no select filter maps it', () => {
    const doc = sourceDoc();
    const textFilter: DashboardGlobalFilter = { ...SELECT_FILTER, fieldType: FieldType.RichText, optionNames: undefined };
    const { result } = renderHook(() => useWidgetExtraFilters([textFilter], 'db1', doc));

    expect(result.current?.[0].content).toBe('a-done');
    doc.destroy();
  });
});
