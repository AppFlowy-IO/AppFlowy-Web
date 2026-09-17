import * as Y from 'yjs';

import { FieldType } from '../database.type';
import { applyFilterUpdate, toggleFilterId } from '../dispatch/filter-update';
import { createRollupField } from '../fields/rollup/utils';
import { YDatabaseFields, YDatabaseFilter, YDatabaseFilters, YjsDatabaseKey as K } from '@/application/types';

function setup(plain: boolean) {
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;

  fields.set('rollup', createRollupField('rollup'));
  const option = fields.get('rollup')!.get(K.type_option).get('16')!;

  option.set(K.relation_field_id, 'relation');
  option.set(K.target_field_id, 'target');
  option.set(K.show_as, 1);
  const filters = doc.getArray('filters') as YDatabaseFilters;
  const meta = {
    target_field_type: 3,
    rollup_filter_mode: 0,
    rollup_show_as: 1,
    relation_field_id: 'relation',
    target_field_id: 'target',
  };
  const rule = {
    id: 'rule',
    field_id: 'rollup',
    ty: FieldType.Rollup,
    condition: 0,
    content: 'a,unresolved',
    rollup_target_ty: 3,
    rollup_meta: meta,
  };
  const sibling = {
    id: 'sibling',
    field_id: 'rollup',
    ty: FieldType.Rollup,
    condition: 1,
    content: 'b',
    rollup_target_ty: 3,
    rollup_meta: { ...meta, rollup_filter_mode: 2 },
  };

  if (plain)
    filters.push([
      {
        id: 'root',
        filter_type: 0,
        children: [rule, { id: 'nested', filter_type: 1, children: [sibling] }],
      } as unknown as YDatabaseFilter,
    ]);
  else {
    const group = new Y.Map();
    const children = new Y.Array();
    const node = new Y.Map();

    Object.entries(rule).forEach(([key, value]) => node.set(key, value));
    group.set('id', 'root');
    group.set('filter_type', 0);
    group.set('children', children);
    children.push([node, { id: 'nested', filter_type: 1, children: [sibling] }]);
    filters.push([group as YDatabaseFilter]);
  }

  return { doc, fields, filters, meta };
}

test.each([false, true])('plain=%s patches just one rule; mode, repeated IDs and sibling survive sync', (plain) => {
  const f = setup(plain);
  const sibling = f.filters.toJSON()[0].children[1];

  applyFilterUpdate(f.filters, f.fields, {
    filterId: 'rule',
    fieldId: 'rollup',
    rollupMetadata: { rollup_filter_mode: 2 },
  });
  applyFilterUpdate(f.filters, f.fields, {
    filterId: 'rule',
    fieldId: 'rollup',
    expectedRollupMetadata: f.meta,
    transformContent: (current) => toggleFilterId(current, 'b', false),
  });
  applyFilterUpdate(f.filters, f.fields, {
    filterId: 'rule',
    fieldId: 'rollup',
    expectedRollupMetadata: f.meta,
    transformContent: (current) => toggleFilterId(current, 'c', false),
  });
  const synced = new Y.Doc();

  Y.applyUpdate(synced, Y.encodeStateAsUpdate(f.doc));
  const tree = synced.getArray('filters').toJSON();

  expect(tree[0]).toMatchObject({ id: 'root', filter_type: 0 });
  expect(tree[0].children[0]).toMatchObject({
    id: 'rule',
    content: 'a,unresolved,b,c',
    rollup_meta: { rollup_filter_mode: 2, target_field_type: 3, rollup_show_as: 1 },
  });
  expect(tree[0].children[1]).toEqual(sibling);
});

test.each([false, true])(
  'plain=%s stale configuration and deleted rule callbacks cannot overwrite the tree',
  (plain) => {
    const f = setup(plain);

    f.fields.get('rollup')!.get(K.type_option).get('16')!.set(K.target_field_id, 'replacement');
    const before = f.filters.toJSON();

    applyFilterUpdate(f.filters, f.fields, {
      filterId: 'rule',
      fieldId: 'rollup',
      expectedRollupMetadata: f.meta,
      content: 'obsolete',
    });
    applyFilterUpdate(f.filters, f.fields, { filterId: 'deleted', content: 'resurrected' });
    expect(f.filters.toJSON()).toEqual(before);
  }
);
