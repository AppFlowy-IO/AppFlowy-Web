import * as Y from 'yjs';

import { YDatabaseView } from '@/application/types';

import {
  DashboardGlobalFilter,
  parseDashboardGlobalFilters,
  resolveExtraFiltersForDatabase,
  sameDashboardGlobalFilters,
  serializeDashboardGlobalFilters,
} from '../dashboard-global-filters';
import { updateDashboardLayoutSetting } from '../dashboard-layout';
import { DASHBOARD_LAYOUT_KEY } from '../dashboard.type';
import { FieldType } from '../database.type';
import { toPlainValue } from '../layout-codec';

import { decodeParityJson, loadParityFixture, normalizeNumbers, seedParityMap } from './dashboard-parity-helpers';

/** `dashboard-parity/layouts/global-filters.json` (WP08 §2), read by Rust and Dart too. */
interface PersistedFilter {
  id: string;
  name: string;
  ty: number;
  condition: number;
  content: string;
  targets: Record<string, string>;
  target_order: string[];
  option_names?: unknown;
}

interface GlobalFiltersCase {
  name: string;
  stored: Record<string, unknown>;
  parsed?: { global_filters: PersistedFilter[] };
  unknownTypeFilterIds?: string[];
  write?: { global_filters: PersistedFilter[] };
  writtenKeys?: string[];
  expected?: Record<string, unknown>;
}

const { cases } = loadParityFixture<{ cases: GlobalFiltersCase[] }>('layouts/global-filters.json');

/** The persisted shape of a typed filter, as a client writes it. */
function persisted(filter: DashboardGlobalFilter): PersistedFilter {
  const [serialized] = serializeDashboardGlobalFilters([filter]);

  return serialized as PersistedFilter;
}

function fromWrite(filter: PersistedFilter): DashboardGlobalFilter {
  const [typed] = parseDashboardGlobalFilters([filter]);

  return typed;
}

function createView(stored: Record<string, unknown>) {
  const doc = new Y.Doc();
  const view = doc.getMap('view') as unknown as YDatabaseView;
  const layouts = new Y.Map();
  const setting = new Y.Map();

  (view as unknown as Y.Map<unknown>).set('layout_settings', layouts);
  layouts.set(DASHBOARD_LAYOUT_KEY, setting);
  seedParityMap(setting, decodeParityJson(stored) as Record<string, unknown>);
  return { doc, view, setting };
}

describe('dashboard global filters (dashboard-parity/layouts/global-filters.json)', () => {
  describe.each(cases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const stored = entry.stored.global_filters as PersistedFilter[];
    const unknownIds = new Set(entry.unknownTypeFilterIds ?? []);

    if (entry.parsed) {
      const parsed = entry.parsed;

      it('reads the typed model', () => {
        const filters = parseDashboardGlobalFilters(stored).filter((filter) => !unknownIds.has(filter.id));

        expect(filters.map(persisted)).toEqual(parsed.global_filters);
      });
    }

    if (entry.write && entry.expected) {
      const write = entry.write;
      const expected = entry.expected;

      it('writes only the listed keys and keeps every unknown key', () => {
        const { view, setting } = createView(entry.stored);
        const before = normalizeNumbers(toPlainValue(setting)) as Record<string, unknown>;
        const changed: string[] = [];

        setting.observe((event) => event.keysChanged.forEach((key) => changed.push(key)));
        updateDashboardLayoutSetting(view, { globalFilters: write.global_filters.map(fromWrite) });

        expect(normalizeNumbers(toPlainValue(setting))).toEqual(expected);
        expect([...new Set(changed)].sort()).toEqual([...(entry.writtenKeys ?? [])].sort());
        if ((entry.writtenKeys ?? []).length === 0) expect(normalizeNumbers(toPlainValue(setting))).toEqual(before);
      });
    }
  });
});

describe('option names in the model', () => {
  const base = parseDashboardGlobalFilters([
    {
      id: 'gf:region',
      name: 'Region',
      ty: FieldType.SingleSelect,
      condition: 0,
      content: 'a-eu',
      targets: { 'db:a': 'f:region', 'db:b': 'f:area' },
      target_order: ['db:a', 'db:b'],
      option_names: ['Europe'],
    },
  ]);

  it('sees an option names change', () => {
    expect(sameDashboardGlobalFilters(base, [{ ...base[0], optionNames: ['Asia'] }])).toBe(false);
    expect(sameDashboardGlobalFilters(base, [{ ...base[0], optionNames: ['Europe'] }])).toBe(true);
    expect(sameDashboardGlobalFilters([{ ...base[0], optionNames: undefined }], [{ ...base[0], optionNames: [] }])).toBe(
      true
    );
  });

  it('omits empty option names and those of other types', () => {
    expect(serializeDashboardGlobalFilters([{ ...base[0], optionNames: [] }])[0]).not.toHaveProperty('option_names');
    expect(
      serializeDashboardGlobalFilters([{ ...base[0], fieldType: FieldType.RichText, optionNames: ['x'] }])[0]
    ).not.toHaveProperty('option_names');
  });

  it('resolves a target with other option ids to its own options by name', () => {
    const source = {
      fields: [
        {
          id: 'f:area',
          type: FieldType.SingleSelect,
          options: [
            { id: 'b-asia', name: 'Asia' },
            { id: 'b-eu', name: 'europe' },
          ],
        },
      ],
    };

    expect(resolveExtraFiltersForDatabase(base, 'db:b', source)[0].content).toBe('b-eu');
    // Not loaded: the ids stay as stored.
    expect(resolveExtraFiltersForDatabase(base, 'db:b')[0].content).toBe('a-eu');
    // A retyped field is skipped later by the evaluator; the content is left alone.
    expect(
      resolveExtraFiltersForDatabase(base, 'db:b', { fields: [{ id: 'f:area', type: FieldType.RichText }] })[0].content
    ).toBe('a-eu');
  });
});
