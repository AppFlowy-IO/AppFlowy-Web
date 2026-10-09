import {
  checkedMergedKeys,
  mergeOptionLists,
  MergeableOption,
  resolveGlobalFilterOptionIds,
  selectedMergedNames,
  setMergedSelection,
  toggleMergedSelection,
  usableOptionNames,
} from '../global-filter-options';

import { loadParityFixture } from './dashboard-parity-helpers';

/** `dashboard-parity/option-merge.json` (WP08 §1.9), shared with desktop. */
interface OptionMergeFixture {
  resolve: {
    name: string;
    content: string;
    option_names?: unknown;
    target_options: MergeableOption[] | null;
    expected: string;
  }[];
  merged_list: {
    name: string;
    targets: { options: MergeableOption[] | null }[];
    content: string;
    option_names?: unknown;
    expected_entries: { key: string; id: string; name: string; color: unknown; ids: string[] }[];
    expected_checked: string[];
    toggle?: { key: string; expected_content: string; expected_option_names: string[] }[];
  }[];
}

const fixture = loadParityFixture<OptionMergeFixture>('option-merge.json');

describe('select options merged by name (dashboard-parity/option-merge.json)', () => {
  it.each(fixture.resolve.map((entry) => [entry.name, entry] as const))('resolve: %s', (_name, entry) => {
    expect(resolveGlobalFilterOptionIds(entry.content, entry.option_names, entry.target_options)).toBe(entry.expected);
  });

  describe.each(fixture.merged_list.map((entry) => [entry.name, entry] as const))('merged list: %s', (_name, entry) => {
    const entries = mergeOptionLists(entry.targets.map((target) => target.options));

    it('merges the options of every loaded target in order', () => {
      expect(entries).toEqual(entry.expected_entries);
    });

    it('checks the entries the selection holds', () => {
      expect([...checkedMergedKeys(entries, entry.content, entry.option_names)].sort()).toEqual(
        [...entry.expected_checked].sort()
      );
    });

    it.each((entry.toggle ?? []).map((toggle) => [toggle.key, toggle] as const))(
      'toggling %s writes the content and the names together',
      (_key, toggle) => {
        expect(toggleMergedSelection(entries, entry.content, entry.option_names, toggle.key)).toEqual({
          content: toggle.expected_content,
          optionNames: toggle.expected_option_names,
        });
      }
    );
  });
});

describe('merged option helpers', () => {
  const entries = mergeOptionLists([
    [
      { id: 'p-eu', name: 'Europe' },
      { id: 'p-asia', name: 'Asia' },
    ],
    [{ id: 't-eu', name: 'EUROPE' }],
  ]);

  it('reads option names only in parallel with the ids', () => {
    expect(usableOptionNames('a,b', ['A', 'B'])).toEqual(['A', 'B']);
    expect(usableOptionNames('a,b', ['A'])).toBeUndefined();
    expect(usableOptionNames('a', 'A')).toBeUndefined();
  });

  it('names the selection in merged order, then the stored names of unknown ids', () => {
    expect(selectedMergedNames(entries, 't-eu,x-mars,p-asia', ['Europe', 'Mars', 'Asia'])).toEqual([
      'Europe',
      'Asia',
      'Mars',
    ]);
    expect(selectedMergedNames(entries, '', undefined)).toEqual([]);
  });

  it('sets an exact selection and keeps the ids of sources that are not loaded', () => {
    expect(setMergedSelection(entries, 'x-mars', ['Mars'], ['asia'])).toEqual({
      content: 'p-asia,x-mars',
      optionNames: ['Asia', 'Mars'],
    });
  });
});
