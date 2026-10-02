import { expect } from '@jest/globals';

import { remapDashboardLayout, remapDashboardOwner } from '@/application/database-yjs/dashboard-owned-views';

import { decodeParityJson, loadParityFixture, normalizeNumbers } from './dashboard-parity-helpers';

interface RemapFixture {
  cases: {
    name: string;
    layout: unknown;
    viewIdMap: Record<string, string>;
    databaseIdMap: Record<string, string>;
    expected: unknown;
    unchanged?: boolean;
  }[];
  ownerCases: { name: string; owner: string; viewIdMap: Record<string, string>; expected: string | null }[];
}

const fixture = loadParityFixture<RemapFixture>('layouts/remap.json');

/** A deep copy that keeps bigints, to prove the input is never mutated. */
function snapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snapshot);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)]));
  }

  return value;
}

describe('remapDashboardLayout (dashboard-parity/layouts/remap.json)', () => {
  it('has database copy, dashboard duplicate, no-op and malformed cases', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(5);
    expect(fixture.cases.some((entry) => entry.unchanged)).toBe(true);
    expect(fixture.ownerCases.length).toBeGreaterThan(0);
  });

  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    const layout = decodeParityJson(entry.layout);
    const before = snapshot(layout);
    const result = remapDashboardLayout(layout, entry.viewIdMap, entry.databaseIdMap);

    expect(normalizeNumbers(result)).toEqual(normalizeNumbers(decodeParityJson(entry.expected)));
    // The input is never mutated, and nothing changed means the very same object.
    expect(layout).toEqual(before);
    if (entry.unchanged) expect(result).toBe(layout);
    else expect(result).not.toBe(layout);
  });

  it('keeps unchanged rows and widgets as the same objects', () => {
    const untouchedRow = { id: 'r:2', height: 360, widgets: [{ id: 'w:2', view_id: 'v:shared', database_id: 'db:a' }] };
    const layout = {
      rows: [{ id: 'r:1', height: 360, widgets: [{ id: 'w:1', view_id: 'v:owned', database_id: 'db:a' }] }, untouchedRow],
      global_filters: [],
    };
    const result = remapDashboardLayout(layout, { 'v:owned': 'v:copy' }, {});

    expect(result.rows[1]).toBe(untouchedRow);
    expect(result.global_filters).toBe(layout.global_filters);
    expect(result.rows[0].widgets[0]).toEqual({ id: 'w:1', view_id: 'v:copy', database_id: 'db:a' });
  });

  it('passes a value that is not a layout through', () => {
    expect(remapDashboardLayout(null, { a: 'b' }, {})).toBeNull();
    expect(remapDashboardLayout('rows', { a: 'b' }, {})).toBe('rows');
  });

  it('ignores inherited keys of the id maps', () => {
    const layout = { rows: [{ id: 'r:1', widgets: [{ id: 'w:1', view_id: 'constructor', database_id: 'toString' }] }] };

    expect(remapDashboardLayout(layout, {}, {})).toBe(layout);
  });
});

describe('remapDashboardOwner (dashboard-parity/layouts/remap.json ownerCases)', () => {
  it.each(fixture.ownerCases.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    expect(remapDashboardOwner(entry.owner, entry.viewIdMap)).toBe(entry.expected);
  });
});
