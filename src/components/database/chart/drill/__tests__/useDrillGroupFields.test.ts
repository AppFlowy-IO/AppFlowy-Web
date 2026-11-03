import * as Y from 'yjs';

import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { FieldType } from '@/application/database-yjs/database.type';
import { YDoc } from '@/application/types';

import { resolveDrillRowDoc } from '../useDrillGroupFields';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

describe('resolveDrillRowDoc', () => {
  const seed = createRowDoc('r1', 'db', { amount: createCell(FieldType.Number, '5') });
  const peek = (rowId: string) => (rowId === 'r1' ? seed : null);

  it('reads the live doc that holds the row', () => {
    const live = createRowDoc('r1', 'db', { amount: createCell(FieldType.Number, '7') });

    expect(resolveDrillRowDoc('r1', { r1: live }, peek)).toBe(live);
  });

  it('reads the seed the chart counted while the live doc is still empty', () => {
    // Opened on its seed before its sync, or reset: in the row map without `database_row` yet.
    const empty = new Y.Doc() as YDoc;

    expect(resolveDrillRowDoc('r1', { r1: empty }, peek)).toBe(seed);
  });

  it('reads the seed of a row that is not open, and the empty live doc of a row without a seed', () => {
    const empty = new Y.Doc() as YDoc;

    expect(resolveDrillRowDoc('r1', {}, peek)).toBe(seed);
    expect(resolveDrillRowDoc('r1', null, peek)).toBe(seed);
    expect(resolveDrillRowDoc('r2', { r2: empty }, peek)).toBe(empty);
    expect(resolveDrillRowDoc('r2', {}, peek)).toBeUndefined();
    expect(resolveDrillRowDoc('r1', {}, undefined)).toBeUndefined();
  });
});
