import { useMemo } from 'react';

import { DateFilter, FieldType, Filter, PersonFilter, SelectOptionFilter, useFieldSelector } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import DateTimeFilterMenu from '@/components/database/components/filters/filter-menu/DateTimeFilterMenu';

import CheckboxFilterMenu from './CheckboxFilterMenu';
import ChecklistFilterMenu from './ChecklistFilterMenu';
import MultiSelectOptionFilterMenu from './MultiSelectOptionFilterMenu';
import NumberFilterMenu from './NumberFilterMenu';
import PersonFilterMenu from './PersonFilterMenu';
import SingleSelectOptionFilterMenu from './SingleSelectOptionFilterMenu';
import TextFilterMenu from './TextFilterMenu';

export function FilterMenu({ filter }: { filter: Filter }) {
  const { field } = useFieldSelector(filter?.fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;

  const menu = useMemo(() => {
    if (!field) return null;
    switch (fieldType) {
      case FieldType.RichText:
      case FieldType.URL:
      case FieldType.Relation:
      case FieldType.Rollup:
        return <TextFilterMenu filter={filter} />;
      case FieldType.Checkbox:
        return <CheckboxFilterMenu filter={filter} />;
      case FieldType.Checklist:
        return <ChecklistFilterMenu filter={filter} />;
      case FieldType.Number:
        return <NumberFilterMenu filter={filter} />;
      case FieldType.MultiSelect:
        return <MultiSelectOptionFilterMenu filter={filter as SelectOptionFilter} />;
      case FieldType.SingleSelect:
        return <SingleSelectOptionFilterMenu filter={filter as SelectOptionFilter} />;
      case FieldType.DateTime:
      case FieldType.LastEditedTime:
      case FieldType.CreatedTime:
        return <DateTimeFilterMenu filter={filter as DateFilter} />;
      case FieldType.Person:
        return <PersonFilterMenu filter={filter as PersonFilter} />;
      default:
        return null;
    }
  }, [field, fieldType, filter]);

  return menu;
}

export default FilterMenu;
