import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { DateFormat } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { getFieldTypeName } from '@/components/database/components/field/FieldLabel';
import { usePersonFilterOptions } from '@/components/database/components/filters/value-controls/usePersonFilterOptions';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { getDateFormat } from '@/utils/time';

import {
  getGlobalFilterPillLabel,
  isGlobalFilterActive,
  isPersonFieldType,
  parsePersonContent,
  Translate,
} from './global-filter.conditions';
import { mergedSelectedNames } from './global-filter.options';
import { getPrimaryTargetField, getUsableTargets, GlobalFilterSource, usesOptionContent } from './global-filter.utils';

export function useGlobalFilterDateFormat() {
  const currentUser = useCurrentUserOptional();

  return getDateFormat((currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat) ?? DateFormat.Local);
}

const NO_IDS: string[] = [];

/**
 * Display names of the people a person filter selects, from the member list
 * the person picker uses. Only fetched for a person filter with a selection.
 */
export function useGlobalFilterPeople(filter: DashboardGlobalFilter): string[] | undefined {
  const person = isPersonFieldType(filter.fieldType);
  const selectedIds = useMemo(() => (person ? parsePersonContent(filter.content) : NO_IDS), [filter.content, person]);
  const { members } = usePersonFilterOptions({
    fieldType: filter.fieldType,
    selectedIds,
    search: '',
    enabled: selectedIds.length > 0,
  });

  return useMemo(() => {
    if (selectedIds.length === 0) return undefined;
    const names = new Map(members.map(({ identifier, user }) => [identifier, user.name]));

    return selectedIds.flatMap((id) => {
      const name = names.get(id);

      return name ? [name] : [];
    });
  }, [members, selectedIds]);
}

/** One tooltip line of a pill: the mapped source's id (unique within a filter) and the text. */
export interface GlobalFilterSourceLine {
  databaseId: string;
  text: string;
}

/**
 * "Status in Projects": one line per usable source of a filter, for the
 * pill's tooltip. Two sources can read the same (same property and source
 * names, or both untitled), so a line is identified by its database id.
 */
export function globalFilterSourceLines(
  filter: DashboardGlobalFilter,
  sources: GlobalFilterSource[],
  t: Translate
): GlobalFilterSourceLine[] {
  const untitled = t('untitled', { defaultValue: 'Untitled' });

  return getUsableTargets(filter, sources).map(({ databaseId, source, field }) => ({
    databaseId,
    text: t('dashboard.globalFilters.sourceLine', {
      property: field?.name || untitled,
      source: source?.name || untitled,
      defaultValue: '{{property}} in {{source}}',
    }),
  }));
}

/**
 * A pill's label and state (WP08 §1.5): `Name: summary` while the filter
 * narrows rows, with merged option names and people's names; how many usable
 * sources it reaches; and the tooltip lines.
 */
export function useGlobalFilterLabel(filter: DashboardGlobalFilter, sources: GlobalFilterSource[]) {
  const { t } = useTranslation();
  const dateFormat = useGlobalFilterDateFormat();
  const people = useGlobalFilterPeople(filter);

  return useMemo(() => {
    const primaryField = getPrimaryTargetField(filter, sources);
    const typeName = getFieldTypeName(filter.fieldType, t);
    // Mappings whose property was deleted or changed type no longer filter anything.
    const sourceCount = getUsableTargets(filter, sources).length;
    const active = sourceCount > 0 && isGlobalFilterActive(filter);
    const mergedNames = usesOptionContent(filter.fieldType) ? mergedSelectedNames(filter, sources) : undefined;

    return {
      text: getGlobalFilterPillLabel(filter, {
        active,
        primaryFieldName: primaryField?.name,
        typeName,
        mergedNames,
        people,
        dateFormat,
        t,
      }),
      active,
      typeName,
      sourceCount,
      sourceLines: globalFilterSourceLines(filter, sources, t),
    };
  }, [filter, sources, people, dateFormat, t]);
}
