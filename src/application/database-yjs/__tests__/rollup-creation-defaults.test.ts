import * as Y from 'yjs';

import { YDatabase, YDatabaseField, YDatabaseFields, YjsDatabaseKey as K } from '@/application/types';

import { CalculationType, FieldType, RollupDisplayMode } from '../database.type';
import { DateFilterCondition } from '../fields/date/date.type';
import { createRollupField } from '../fields/rollup/utils';
import { getDefaultFilterCondition } from '../filter';
import { migrateRollupFilters, newRollupFilterMetadata, rememberRollupTarget } from '../rollup/filter';

function setup(sourceType: FieldType, showAs = RollupDisplayMode.OriginalList, calculation = CalculationType.Count) {
  const doc = new Y.Doc();
  const database = doc.getMap('database') as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;

  database.set(K.fields, fields);
  fields.set('rollup', createRollupField('rollup'));
  const field = fields.get('rollup');
  const option = field.get(K.type_option).get(String(FieldType.Rollup));

  option.set(K.relation_field_id, 'relation');
  option.set(K.target_field_id, 'target');
  option.set(K.show_as, showAs);
  option.set(K.calculation_type, calculation);
  const target = doc.getMap('target') as YDatabaseField;

  target.set(K.id, 'target');
  target.set(K.type, sourceType);
  rememberRollupTarget(field, target);
  return { database, field, option };
}

describe('rollup creation defaults differ from configuration resets', () => {
  const now = new Date(2026, 8, 12, 16, 23, 45);
  const localToday = new Date(2026, 8, 12).getTime() / 1000;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test.each([FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime])(
    'creating a date list for source %s starts on local today',
    (sourceType) => {
      const { field } = setup(sourceType);

      expect(getDefaultFilterCondition(FieldType.Rollup, field)).toEqual({
        condition: DateFilterCondition.DateStartsOn,
        content: JSON.stringify({ timestamp: localToday }),
      });
    }
  );

  test.each([CalculationType.DateEarliest, CalculationType.DateLatest, CalculationType.DateRange])(
    'creating a calculated date (%s) starts on local today',
    (calculation) => {
      const { field } = setup(FieldType.DateTime, RollupDisplayMode.Calculated, calculation);

      expect(getDefaultFilterCondition(FieldType.Rollup, field)).toEqual({
        condition: DateFilterCondition.DateStartsOn,
        content: JSON.stringify({ timestamp: localToday }),
      });
    }
  );

  test.each([RollupDisplayMode.OriginalList, RollupDisplayMode.UniqueList])(
    'creating a media list (%s) initially shows related attachments',
    (showAs) => {
      const { field } = setup(FieldType.Media, showAs);

      expect(getDefaultFilterCondition(FieldType.Rollup, field)).toEqual({ condition: 1, content: '' });
    }
  );

  test.each([FieldType.DateTime, FieldType.Media, FieldType.Checklist])(
    'creating Count over source %s still uses an unfinished numeric Equal predicate',
    (sourceType) => {
      const { field } = setup(sourceType, RollupDisplayMode.Calculated);

      expect(getDefaultFilterCondition(FieldType.Rollup, field)).toEqual({ condition: 0, content: '' });
    }
  );

  test.each([FieldType.DateTime, FieldType.Media])(
    'replacing source %s retains the desktop empty migration default',
    (sourceType) => {
      const { database, field, option } = setup(sourceType);
      const views = new Y.Map();
      const view = new Y.Map();
      const filters = new Y.Array();

      database.set(K.views, views);
      views.set('view', view);
      view.set(K.filters, filters);
      filters.push([
        {
          id: 'rule',
          field_id: 'rollup',
          rollup_target_ty: sourceType,
          rollup_meta: newRollupFilterMetadata(field, sourceType),
          ...getDefaultFilterCondition(FieldType.Rollup, field),
        },
      ]);
      option.set(K.target_field_id, 'replacement');
      migrateRollupFilters(database, 'rollup', sourceType);

      expect(filters.toJSON()[0]).toMatchObject({
        id: 'rule',
        condition: 0,
        content: '',
        rollup_meta: { target_field_id: 'replacement', rollup_filter_mode: 0 },
      });
    }
  );
});
