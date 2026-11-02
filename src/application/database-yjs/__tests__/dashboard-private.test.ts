import * as Y from 'yjs';

import { parseDashboardGlobalFilters } from '../dashboard-global-filters';
import {
  applyPrivateGlobalValues,
  canonicalContent,
  dashboardPrivateStorageKey,
  decodeDashboardPrivatePayload,
  encodeDashboardPrivatePayload,
  isDashboardPrivateKeyOfUser,
  plainToYCondition,
  PrivateGlobalValue,
  PrivateWidgetEntry,
  prunePrivateGlobalValues,
  sameFilters,
  sameGlobalFilterValue,
  sameSorts,
  sanitizePrivateWidgetEntry,
} from '../dashboard-private';
import { FieldType } from '../database.type';

import { loadParityFixture } from './dashboard-parity-helpers';

/** `dashboard-parity/private-state.json` (WP07), shared with desktop (Dart and Rust). */
interface PrivateStateFixture {
  storage_key: {
    name: string;
    workspace_id: string;
    user_id: string | null;
    dashboard_view_id: string;
    expected: string | null;
  }[];
  filter_equality: { name: string; a: unknown[]; b: unknown[]; equal: boolean }[];
  sort_equality: { name: string; a: unknown[]; b: unknown[]; equal: boolean }[];
  global_value_equality: {
    name: string;
    field_type: number;
    a: PrivateGlobalValue;
    b: PrivateGlobalValue;
    equal: boolean;
  }[];
  payload_decode: { name: string; raw: string; expected: unknown }[];
  payload_encode: {
    name: string;
    state: Parameters<typeof encodeDashboardPrivatePayload>[0];
    now: number;
    expected: unknown;
  }[];
  restore_global: { name: string; saved: unknown[]; values: Record<string, PrivateGlobalValue>; expected: unknown }[];
  restore_widget: {
    name: string;
    fields: Record<string, number>;
    saved: { filters: unknown[]; sorts: unknown[] };
    entry: PrivateWidgetEntry;
    expected: PrivateWidgetEntry;
  }[];
}

const fixture = loadParityFixture<PrivateStateFixture>('private-state.json');

describe('dashboard private state (dashboard-parity/private-state.json)', () => {
  it.each(fixture.storage_key.map((entry) => [entry.name, entry] as const))('storage key: %s', (_name, entry) => {
    expect(dashboardPrivateStorageKey(entry.workspace_id, entry.user_id, entry.dashboard_view_id)).toBe(entry.expected);
  });

  it.each(fixture.filter_equality.map((entry) => [entry.name, entry] as const))(
    'filter equality: %s',
    (_name, entry) => {
      expect(sameFilters(entry.a, entry.b)).toBe(entry.equal);
      expect(sameFilters(entry.b, entry.a)).toBe(entry.equal);
    }
  );

  it.each(fixture.sort_equality.map((entry) => [entry.name, entry] as const))('sort equality: %s', (_name, entry) => {
    expect(sameSorts(entry.a, entry.b)).toBe(entry.equal);
    expect(sameSorts(entry.b, entry.a)).toBe(entry.equal);
  });

  it.each(fixture.global_value_equality.map((entry) => [entry.name, entry] as const))(
    'global value equality: %s',
    (_name, entry) => {
      expect(sameGlobalFilterValue(entry.field_type, entry.a, entry.b)).toBe(entry.equal);
      expect(sameGlobalFilterValue(entry.field_type, entry.b, entry.a)).toBe(entry.equal);
    }
  );

  it.each(fixture.payload_decode.map((entry) => [entry.name, entry] as const))('payload decode: %s', (_name, entry) => {
    expect(decodeDashboardPrivatePayload(entry.raw)).toEqual(entry.expected);
  });

  it.each(fixture.payload_encode.map((entry) => [entry.name, entry] as const))('payload encode: %s', (_name, entry) => {
    expect(encodeDashboardPrivatePayload(entry.state, entry.now)).toEqual(entry.expected);
  });

  it.each(fixture.restore_global.map((entry) => [entry.name, entry] as const))('restore global: %s', (_name, entry) => {
    expect(prunePrivateGlobalValues(entry.values, parseDashboardGlobalFilters(entry.saved))).toEqual(entry.expected);
  });

  it.each(fixture.restore_widget.map((entry) => [entry.name, entry] as const))('restore widget: %s', (_name, entry) => {
    expect(sanitizePrivateWidgetEntry(entry.entry, entry.fields, entry.saved)).toEqual(entry.expected);
  });
});

describe('dashboard private state helpers', () => {
  const saved = parseDashboardGlobalFilters([
    { id: 'gf-stage', name: 'Stage', ty: 3, condition: 0, content: 'o-done', targets: { db: 'stage' } },
  ]);

  it('applyPrivateGlobalValues returns the saved list itself when nothing applies', () => {
    expect(applyPrivateGlobalValues(saved, {})).toBe(saved);
    expect(applyPrivateGlobalValues(saved, { 'gf-other': { condition: 1, content: '' } })).toBe(saved);
  });

  it('applyPrivateGlobalValues replaces the value, option names included', () => {
    const [filter] = applyPrivateGlobalValues(saved, {
      'gf-stage': { condition: 1, content: 'o-eu', option_names: ['Europe'] },
    });

    expect(filter).toMatchObject({ id: 'gf-stage', condition: 1, content: 'o-eu', optionNames: ['Europe'] });
    expect(filter.targets).toBe(saved[0].targets);
  });

  it('prunePrivateGlobalValues returns the values themselves when unchanged', () => {
    const values = { 'gf-stage': { condition: 1, content: 'o-done' } };

    expect(prunePrivateGlobalValues(values, saved)).toBe(values);
  });

  it('encode returns null when nothing is dirty', () => {
    expect(encodeDashboardPrivatePayload({ global_filters: {}, widgets: {} }, 1)).toBeNull();
  });

  it('decodes nothing without a stored value', () => {
    expect(decodeDashboardPrivatePayload(null)).toBeNull();
    expect(decodeDashboardPrivatePayload(undefined)).toBeNull();
  });

  it('canonicalizes content by field type', () => {
    expect(canonicalContent(FieldType.MultiSelect, ' b, a,,a ')).toBe('a,a,b');
    expect(canonicalContent(FieldType.Person, '["u2","u1"]')).toBe('["u1","u2"]');
    expect(canonicalContent(FieldType.Person, 'u2, u1')).toBe('u1,u2');
    expect(canonicalContent(FieldType.DateTime, '{"b":1,"a":null}')).toBe('{"b":1}');
    expect(canonicalContent(FieldType.DateTime, ' not json ')).toBe('not json');
    expect(canonicalContent(FieldType.Checkbox, 'Yes')).toBe('');
    expect(canonicalContent(FieldType.RichText, ' Acme ')).toBe(' Acme ');
  });

  it('compares Y.Arrays of condition maps like their JSON', () => {
    const doc = new Y.Doc();
    const a = doc.getArray('a');
    const b = doc.getArray('b');

    a.push([plainToYCondition({ id: 'x', filter_type: 2, field_id: 'f', ty: 3, condition: 0, content: 'o-a,o-b' })]);
    b.push([{ id: 'y', filter_type: '2', field_id: 'f', ty: BigInt(3), condition: 0, content: 'o-b,o-a' }]);
    expect(sameFilters(a, b)).toBe(true);
  });

  it('plainToYCondition builds Yjs types and numbers', () => {
    const doc = new Y.Doc();
    const array = doc.getArray('filters');
    const converted = plainToYCondition({ id: 'g', children: [{ id: 'c', condition: BigInt(2) }] });

    array.push([converted]);
    expect(converted).toBeInstanceOf(Y.Map);
    expect(array.toJSON()).toEqual([{ id: 'g', children: [{ id: 'c', condition: 2 }] }]);
  });

  it('matches the keys of one user for sign-out', () => {
    expect(isDashboardPrivateKeyOfUser('af.dashboard.private.v1:ws:42:dash', 42)).toBe(true);
    expect(isDashboardPrivateKeyOfUser('af.dashboard.private.v1:ws:420:dash', '42')).toBe(false);
    expect(isDashboardPrivateKeyOfUser('other:ws:42:dash', '42')).toBe(false);
  });
});
