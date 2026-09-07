import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { getGroupRowCellsData } from '@/application/database-yjs/group-row';
import { YjsDatabaseKey } from '@/application/types';
import type {
  YDatabaseField,
  YDatabaseFields,
  YDatabaseGroup,
  YDatabaseGroups,
  YDatabaseView,
} from '@/application/types';

function createFixture() {
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;
  const field = new Y.Map() as YDatabaseField;
  const view = doc.getMap('view') as YDatabaseView;
  const group = new Y.Map() as YDatabaseGroup;
  const groups = new Y.Array<YDatabaseGroup>() as YDatabaseGroups;

  field.set(YjsDatabaseKey.id, 'amount');
  field.set(YjsDatabaseKey.type, FieldType.Number);
  fields.set('amount', field);
  group.set(YjsDatabaseKey.field_id, 'amount');
  groups.push([group]);
  view.set(YjsDatabaseKey.groups, groups);

  const configure = (interval: string, mode = 2) =>
    group.set(
      YjsDatabaseKey.content,
      JSON.stringify({ mode, range_start: '-1', range_end: '1', range_interval: interval })
    );

  configure('0.5');
  return { fields, view, configure };
}

describe('grouped row insertion', () => {
  it('uses decimal boundaries and reads changed overflow intervals at insertion time', () => {
    const { fields, view, configure } = createFixture();
    const prefill = (id: string) => getGroupRowCellsData(fields, 'amount', id, view);

    expect(prefill('number_interval_-0.5_0')).toEqual({ amount: '-0.5' });
    expect(prefill('number_interval_closed_0.5_1')).toEqual({ amount: '0.5' });
    expect(prefill('number_below_-1')).toEqual({ amount: '-1.5' });
    expect(prefill('number_above_1')).toEqual({ amount: '1.5' });

    configure('0.25');
    expect(prefill('number_below_-1')).toEqual({ amount: '-1.25' });
    expect(prefill('number_above_1')).toEqual({ amount: '1.25' });
    expect(prefill('number_interval_-0.5_0')).toBeUndefined();
  });

  it('prefills exact zero separately from missing and rejects stale range groups after a mode change', () => {
    const { fields, view, configure } = createFixture();

    configure('0.5', 1);
    expect(getGroupRowCellsData(fields, 'amount', 'number_value_0', view)).toEqual({ amount: '0' });
    expect(getGroupRowCellsData(fields, 'amount', 'number_value_1.25', view)).toEqual({ amount: '1.25' });
    expect(getGroupRowCellsData(fields, 'amount', 'amount', view)).toEqual({ amount: '' });
    expect(getGroupRowCellsData(fields, 'amount', 'number_below_-1', view)).toBeUndefined();
  });
});
