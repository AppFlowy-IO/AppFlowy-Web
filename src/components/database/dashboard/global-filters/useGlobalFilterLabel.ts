import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { DateFormat } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { getFieldTypeName } from '@/components/database/components/field/FieldLabel';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { getDateFormat } from '@/utils/time';

import {
  getGlobalFilterChipText,
  getGlobalFilterDescription,
  isGlobalFilterActive,
  Translate,
} from './global-filter.conditions';
import { countGlobalFilterSources, getPrimaryTargetField, GlobalFilterSource } from './global-filter.utils';

/** "1 source" / "3 sources": how many databases a filter (or a property type) reaches. */
export function globalFilterSourcesText(t: Translate, count: number): string {
  return t('dashboard.globalFilters.sources', {
    count,
    defaultValue: '{{count}} sources',
    defaultValue_one: '{{count}} source',
    defaultValue_other: '{{count}} sources',
  });
}

export function useGlobalFilterDateFormat() {
  const currentUser = useCurrentUserOptional();

  return getDateFormat((currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat) ?? DateFormat.Local);
}

/** Chip / list label of a global filter: `Name: summary`, plus its state. */
export function useGlobalFilterLabel(filter: DashboardGlobalFilter, sources: GlobalFilterSource[]) {
  const { t } = useTranslation();
  const dateFormat = useGlobalFilterDateFormat();

  return useMemo(() => {
    const primaryField = getPrimaryTargetField(filter, sources);
    const typeName = getFieldTypeName(filter.fieldType, t);
    const description = getGlobalFilterDescription(filter, { primaryField, dateFormat, t });
    // Mappings whose property was deleted or changed type no longer filter anything.
    const sourceCount = countGlobalFilterSources(filter, sources);
    // Same as `isGlobalFilterActive(filter, sources)`, reusing the usable-source count.
    const active = sourceCount > 0 && isGlobalFilterActive(filter);

    return {
      text: getGlobalFilterChipText(filter, description, primaryField?.name || typeName, active),
      active,
      typeName,
      sourceCount,
      sourceLabel: globalFilterSourcesText(t, sourceCount),
    };
  }, [filter, sources, dateFormat, t]);
}
