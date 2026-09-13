import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { YDatabaseFields, YDatabaseFilter, YDatabaseFilters } from '@/application/types';

import { FieldType } from '../../database.type';
import { createRollupField } from '../../fields/rollup/utils';
import { useRelativeDateFilterRefresh } from '../useRelativeDateFilterRefresh';

it('refreshes an open relative rollup filter after local midnight and stops when removed', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-12T23:59:59'));
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;
  const filters = doc.getArray('filters') as YDatabaseFilters;

  fields.set('rollup', createRollupField('rollup'));
  filters.push([
    {
      id: 'rule',
      field_id: 'rollup',
      filter_type: 2,
      condition: 16,
      content: '',
      rollup_target_ty: FieldType.DateTime,
      rollup_meta: { target_field_type: FieldType.DateTime, rollup_filter_mode: 0, rollup_show_as: 1 },
    } as unknown as YDatabaseFilter,
  ]);
  const refresh = jest.fn();
  const { unmount } = renderHook(() => useRelativeDateFilterRefresh(filters, fields, refresh));

  act(() => { jest.advanceTimersByTime(2000); });
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => filters.delete(0));
  act(() => { jest.advanceTimersByTime(86400000); });
  expect(refresh).toHaveBeenCalledTimes(1);
  unmount();
  jest.useRealTimers();
});
