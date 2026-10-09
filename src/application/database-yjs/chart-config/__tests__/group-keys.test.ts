import dayjs from 'dayjs';

import { loadParityFixture } from '../../__tests__/dashboard-parity-helpers';
import { FieldType } from '../../database.type';
import { TextFilterCondition } from '../../fields/text/text.type';
import { textFilterCheck } from '../../filter';
import { chartGroupRefs, firstLetterKey } from '../group-keys';
import { canonicalNumber } from '../number-buckets';

import {
  axisFormatter,
  cellValueOf,
  dateConditionOf,
  decodeHint,
  fieldTypeOf,
  FixtureLabels,
  groupLabelsOf,
} from './fixture-helpers';

interface Member {
  id: string;
  name: string;
  email?: string;
}

interface CellCase {
  name: string;
  field: {
    type: string;
    name: string;
    options?: { id: string; name: string }[];
    persons?: { id: string; name: string }[];
    members?: Member[];
    relationTitles?: Record<string, string>;
    numberFormat?: number;
  };
  dateCondition?: string;
  textGrouping?: 'exact' | 'first_letter';
  buckets?: { size: number; start: number; min?: number; max?: number };
  now: string;
  value: unknown;
  expect: { key: string; label: string; hint: { rank?: number | string; tie?: string; label?: boolean } }[];
}

const fixture = loadParityFixture<{
  labels: FixtureLabels;
  cells: CellCase[];
  canonicalNumber: [number, string][];
}>('group-keys.json');
const labels = groupLabelsOf(fixture.labels);

describe('chartGroupRefs (dashboard-parity/group-keys.json#cells)', () => {
  it('covers every X type of WP11 §1.4', () => {
    const types = new Set(fixture.cells.map((entry) => entry.field.type));

    [
      'SingleSelect',
      'MultiSelect',
      'Checkbox',
      'DateTime',
      'CreatedTime',
      'Person',
      'CreatedBy',
      'LastEditedBy',
      'Relation',
      'RichText',
      'URL',
      'Number',
    ].forEach((type) => expect(types.has(type)).toBe(true));
  });

  it.each(fixture.cells.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    const type = fieldTypeOf(entry.field.type);
    const members = new Map((entry.field.members ?? []).map((member) => [member.id, member]));
    const persons = new Map((entry.field.persons ?? []).map((person) => [person.id, person.name]));
    const refs = chartGroupRefs(
      cellValueOf(type, entry.value),
      { type, name: entry.field.name, options: entry.field.options },
      {
        dateCondition: dateConditionOf(entry.dateCondition),
        textGrouping: entry.textGrouping ?? 'exact',
        labels,
        now: dayjs(entry.now),
        // The fixture's labels are English (en-US dates, `formatChartDateLabel`).
        locale: 'en-US',
        buckets: entry.buckets ?? null,
        formatAxis: axisFormatter(entry.field.numberFormat),
        names: {
          person: (id) => members.get(id)?.name || persons.get(id),
          user: (id) => members.get(id)?.name || members.get(id)?.email,
          relation: (id) => entry.field.relationTitles?.[id],
        },
      }
    );

    expect(refs).toEqual(entry.expect.map((ref) => ({ ...ref, hint: decodeHint(ref.hint) })));
  });
});

describe('canonicalNumber (dashboard-parity/group-keys.json#canonicalNumber)', () => {
  it.each(fixture.canonicalNumber.map(([input, output]) => [String(input), input, output] as const))(
    '%s',
    (_, input, output) => {
      expect(canonicalNumber(input)).toBe(output);
    }
  );
});

describe('firstLetterKey', () => {
  type SegmenterConstructor = new (...args: unknown[]) => unknown;
  const intl = Intl as unknown as { Segmenter?: SegmenterConstructor };
  const segmenter = intl.Segmenter;

  afterEach(() => {
    intl.Segmenter = segmenter;
  });

  /** The module looks `Intl.Segmenter` up once, on first use: a fresh copy sees the current one. */
  function freshFirstLetterKey(): typeof firstLetterKey {
    let fresh: typeof firstLetterKey | undefined;

    jest.isolateModules(() => {
      fresh = (jest.requireActual('../group-keys') as { firstLetterKey: typeof firstLetterKey }).firstLetterKey;
    });
    return fresh!;
  }

  it('falls back to code points and combining marks without Intl.Segmenter', () => {
    intl.Segmenter = undefined;
    const fallback = freshFirstLetterKey();

    expect(fallback('éclair')).toEqual({ key: 'l:É', label: 'É' });
    expect(fallback('éclair')).toEqual({ key: 'l:É', label: 'É' });
    expect(fallback('42 things')).toEqual({ key: 'l:#', label: '#' });
    expect(fallback('')).toEqual({ key: 'l:#', label: '#' });
  });

  it('builds one grapheme segmenter for every text, not one per call', () => {
    expect(segmenter).toBeDefined();
    let constructed = 0;

    intl.Segmenter = new Proxy(segmenter!, {
      construct(target, args) {
        constructed += 1;
        return Reflect.construct(target, args);
      },
    });
    const cached = freshFirstLetterKey();

    ['apple', 'Zebra', '😀 party', 'apple', '42 things'].forEach((text) => cached(text));
    expect(cached('apple')).toEqual({ key: 'l:A', label: 'A' });
    expect(constructed).toBe(1);
  });

  it('treats an emoji as #', () => {
    expect(firstLetterKey('😀 party')).toEqual({ key: 'l:#', label: '#' });
  });

  it('groups every spelling of a text under the key its TextIs drill-down filter matches', () => {
    const context = { dateCondition: 3, textGrouping: 'exact' as const, labels, now: dayjs(), locale: 'en-US' };
    const field = { type: FieldType.RichText, name: 'Name' };
    const keyOf = (text: string) => chartGroupRefs({ kind: 'text', text }, field, context)[0];

    expect(keyOf('Apple').key).toBe(keyOf('apple').key);
    expect(keyOf('Apple').key).toBe(keyOf('  APPLE ').key);
    // The label is the cell as spelled; the group takes the first row's.
    expect(keyOf('Apple').label).toBe('Apple');
    expect(keyOf('apple').label).toBe('apple');
    // Clicking the bar filters with TextIs on the key: every row of the group matches it.
    ['Apple', 'apple', 'APPLE'].forEach((cell) => {
      expect(textFilterCheck(cell, keyOf('Apple').key.slice(2), TextFilterCondition.TextIs)).toBe(true);
    });
    expect(textFilterCheck('Apples', keyOf('Apple').key.slice(2), TextFilterCondition.TextIs)).toBe(false);
  });

  it('never yields a group for a checkbox as empty', () => {
    const refs = chartGroupRefs(
      { kind: 'checkbox', checked: false },
      { type: FieldType.Checkbox, name: 'Done' },
      { dateCondition: 3, textGrouping: 'exact', labels, now: dayjs(), locale: 'en-US' }
    );

    expect(refs.map((ref) => ref.key)).toEqual(['unchecked']);
  });
});
