import { describe, expect, it } from '@jest/globals';

import { getLiveRelationRowIds } from '../relationRowOrders';

describe('getLiveRelationRowIds', () => {
  it('excludes tombstoned rows from relation picker candidates', () => {
    expect(
      getLiveRelationRowIds([
        { id: 'row-1' },
        { id: 'row-2', is_deleted: true },
        { id: 'row-3', is_deleted: false },
      ])
    ).toEqual(['row-1', 'row-3']);
  });
});
