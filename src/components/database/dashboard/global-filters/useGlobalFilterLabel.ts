import { useTranslation } from 'react-i18next';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { DateFormat } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { getDateFormat } from '@/utils/time';

import {
  getFieldTypeName,
  getGlobalFilterChipText,
  getGlobalFilterDescription,
  isGlobalFilterActive,
} from './global-filter.conditions';
import { countGlobalFilterSources, getPrimaryTargetField, GlobalFilterSource } from './global-filter.utils';

export function useGlobalFilterDateFormat() {
  const currentUser = useCurrentUserOptional();

  return getDateFormat((currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat) ?? DateFormat.Local);
}

/** Chip / list label of a global filter: `Name: summary`, plus its state. */
export function useGlobalFilterLabel(filter: DashboardGlobalFilter, sources: GlobalFilterSource[]) {
  const { t } = useTranslation();
  const dateFormat = useGlobalFilterDateFormat();
  const primaryField = getPrimaryTargetField(filter, sources);
  const typeName = getFieldTypeName(filter.fieldType, t);
  const description = getGlobalFilterDescription(filter, { primaryField, dateFormat, t });
  // Mappings whose property was deleted or changed type no longer filter anything.
  const sourceCount = countGlobalFilterSources(filter, sources);

  return {
    text: getGlobalFilterChipText(filter, description, primaryField?.name || typeName, sources),
    active: isGlobalFilterActive(filter, sources),
    typeName,
    sourceCount,
    sourceLabel: t('dashboard.globalFilters.sources', {
      count: sourceCount,
      defaultValue: '{{count}} sources',
      defaultValue_one: '{{count}} source',
      defaultValue_other: '{{count}} sources',
    }),
  };
}
