import i18next from 'i18next';

import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { parseDashboardGlobalFilters } from '@/application/database-yjs/dashboard-global-filters';
import en from '@/@types/translations/en.json';

import { getGlobalFilterPillLabel, Translate } from '../global-filter.conditions';

/** `dashboard-parity/gfilter-labels.json` (WP08 §1.5), shared with desktop. */
interface LabelsFixture {
  labels: {
    name: string;
    filter: { name: string; ty: number; condition: number; content: string };
    type_name: string;
    primary_field_name?: string;
    merged_names?: string[];
    people?: string[];
    active: boolean;
    date_format: string;
    expected: string;
  }[];
}

const { labels } = loadParityFixture<LabelsFixture>('gfilter-labels.json');
const i18n = i18next.createInstance();

void i18n.init({ lng: 'en', initImmediate: false, resources: { en: { translation: en } } });
const t: Translate = (key, options) => i18n.t(key, options as never) as string;

describe('global filter pill labels (dashboard-parity/gfilter-labels.json)', () => {
  it.each(labels.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const [filter] = parseDashboardGlobalFilters([{ id: 'gf', targets: {}, ...entry.filter }]);

    expect(
      getGlobalFilterPillLabel(filter, {
        active: entry.active,
        primaryFieldName: entry.primary_field_name,
        typeName: entry.type_name,
        mergedNames: entry.merged_names,
        people: entry.people,
        dateFormat: entry.date_format,
        t,
      })
    ).toBe(entry.expected);
  });

  it('reads the same with the defaults of every new key (other locales fall back to English)', () => {
    const fallback: Translate = (key, options) => {
      const count = options?.count as number | undefined;
      const template = String(
        (count === 1 ? options?.defaultValue_one : options?.defaultValue_other) ?? options?.defaultValue ?? key
      );

      return template.replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name] ?? ''));
    };

    labels
      .filter((entry) => !entry.expected.includes('Today') && !/(Yesterday|Tomorrow|week)$/.test(entry.expected))
      .forEach((entry) => {
        const [filter] = parseDashboardGlobalFilters([{ id: 'gf', targets: {}, ...entry.filter }]);

        expect(
          getGlobalFilterPillLabel(filter, {
            active: entry.active,
            primaryFieldName: entry.primary_field_name,
            typeName: entry.type_name,
            mergedNames: entry.merged_names,
            people: entry.people,
            dateFormat: entry.date_format,
            t: fallback,
          })
        ).toBe(entry.expected);
      });
  });
});
