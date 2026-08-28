import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { CalculationType, FieldType } from '@/application/database-yjs/database.type';
import { useUpdateRollupTypeOption } from '@/application/database-yjs/dispatch';
import { parseRollupTypeOption, parseRollupVisualizationOption } from '@/application/database-yjs/fields/rollup/parse';
import { RollupShowAsType } from '@/application/database-yjs/fields/rollup/rollup.type';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import { getRollupVisualizationRatio } from '@/application/database-yjs/fields/rollup/visualization';
import { YDatabase, YDatabaseFields, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

describe('rollup visualization persistence', () => {
  it('keeps legacy rollups read-only until a visualization is explicitly selected', () => {
    const doc = new Y.Doc();
    const fields = doc.getMap('fields');
    const field = createRollupField('rollup');

    fields.set('rollup', field);
    const parsed = parseRollupTypeOption(field);

    expect(parsed.__rollup_show_as_type__).toBeUndefined();
    expect(parsed.__rollup_show_as_color__).toBeUndefined();
    expect(parseRollupVisualizationOption(parsed)).toEqual({
      type: RollupShowAsType.Number,
      color: 'fill-default',
      divisor: 0,
      showNumber: false,
    });
  });

  it('writes the exact Desktop Yjs extension keys', () => {
    const databaseDoc = new Y.Doc({ guid: 'database' }) as YDoc;
    const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
    const database = new Y.Map() as YDatabase;
    const fields = new Y.Map() as YDatabaseFields;
    const field = createRollupField('rollup');

    fields.set('rollup', field);
    database.set(YjsDatabaseKey.fields, fields);
    sharedRoot.set(YjsEditorKey.database, database);

    const context = {
      databaseDoc,
      databasePageId: 'view',
      activeViewId: 'view',
      rowMap: {},
      workspaceId: 'workspace',
      readOnly: false,
    } as DatabaseContextState;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
    );
    const { result } = renderHook(() => useUpdateRollupTypeOption('rollup'), { wrapper });

    act(() => {
      result.current({
        visualization_type: RollupShowAsType.Ring,
        visualization_color: 'text-color-2',
        visualization_divisor: 80,
        visualization_show_number: true,
      });
    });

    const stored = field.get(YjsDatabaseKey.type_option).get(String(FieldType.Rollup));

    expect(stored.get('__rollup_show_as_type__')).toBe(RollupShowAsType.Ring);
    expect(stored.get('__rollup_show_as_color__')).toBe('text-color-2');
    expect(stored.get('__rollup_show_as_divisor__')).toBe(80);
    expect(stored.get('__rollup_show_as_show_number__')).toBe(true);
  });
});

describe('rollup visualization fill', () => {
  it('uses a fixed 100 divisor for percentage calculations and clamps the result', () => {
    expect(getRollupVisualizationRatio(75, CalculationType.PercentNotEmpty, 20)).toBe(0.75);
    expect(getRollupVisualizationRatio(120, CalculationType.PercentNotEmpty, 20)).toBe(1);
  });

  it('uses the configured divisor with the Desktop fallback and handles invalid values', () => {
    expect(getRollupVisualizationRatio(40, CalculationType.Sum, 80)).toBe(0.5);
    expect(getRollupVisualizationRatio(40, CalculationType.Sum, 0)).toBe(0.4);
    expect(getRollupVisualizationRatio(-1, CalculationType.Sum, 80)).toBe(0);
    expect(getRollupVisualizationRatio(Number.NaN, CalculationType.Sum, 80)).toBe(0);
  });
});
