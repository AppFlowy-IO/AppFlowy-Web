import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CheckboxFilterCondition,
  ChecklistFilterCondition,
  FieldType,
  Filter,
  PersonFilterCondition,
  SelectOptionFilter,
  useFieldSelector,
} from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import DateFilterContentOverview from '@/components/database/components/filters/overview/DateFilterContentOverview';
import NumberFilterContentOverview from '@/components/database/components/filters/overview/NumberFilterContentOverview';
import SelectFilterContentOverview from '@/components/database/components/filters/overview/SelectFilterContentOverview';
import TextFilterContentOverview from '@/components/database/components/filters/overview/TextFilterContentOverview';

export function FilterContentOverview({ filter }: { filter: Filter }) {
  const { field } = useFieldSelector(filter?.fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const { t } = useTranslation();

  return useMemo(() => {
    if (!field) return null;
    switch (fieldType) {
      case FieldType.RichText:
      case FieldType.URL:
      case FieldType.Relation:
      case FieldType.Rollup:
        return <TextFilterContentOverview filter={filter} />;
      case FieldType.Number:
        return <NumberFilterContentOverview filter={filter} />;
      case FieldType.DateTime:
      case FieldType.LastEditedTime:
      case FieldType.CreatedTime:
        return <DateFilterContentOverview filter={filter} />;
      case FieldType.SingleSelect:
      case FieldType.MultiSelect:
        return <SelectFilterContentOverview field={field} filter={filter as SelectOptionFilter} />;
      case FieldType.Checkbox:
        return (
          <>
            :{' '}
            {filter.condition === CheckboxFilterCondition.IsChecked
              ? t('grid.checkboxFilter.isChecked')
              : t('grid.checkboxFilter.isUnchecked')}
          </>
        );
      case FieldType.Checklist:
        return (
          <>
            :{' '}
            {filter.condition === ChecklistFilterCondition.IsComplete
              ? t('grid.checklistFilter.isComplete')
              : t('grid.checklistFilter.isIncomplted')}
          </>
        );
      case FieldType.Person:
        return (
          <>
            :{' '}
            {filter.condition === PersonFilterCondition.PersonContains
              ? t('grid.personFilter.contains')
              : filter.condition === PersonFilterCondition.PersonDoesNotContain
              ? t('grid.personFilter.doesNotContain')
              : filter.condition === PersonFilterCondition.PersonIsEmpty
              ? t('grid.personFilter.isEmpty')
              : filter.condition === PersonFilterCondition.PersonIsNotEmpty
              ? t('grid.personFilter.isNotEmpty')
              : ''}
          </>
        );
      default:
        return null;
    }
  }, [field, fieldType, filter, t]);
}
