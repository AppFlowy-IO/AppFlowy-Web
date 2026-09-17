import { createContext, useContext } from 'react';

import { useUpdateAdvancedFilter, UpdateFilterParams } from '@/application/database-yjs/dispatch/sort-filter';
import { YDatabaseField } from '@/application/types';

export const FilterEditorContext = createContext<{
  field?: YDatabaseField;
  updateFilter: (params: UpdateFilterParams) => void;
} | null>(null);

export const useFilterEditorContext = () => useContext(FilterEditorContext);

export function useFilterValueUpdater() {
  const updateFilter = useUpdateAdvancedFilter();
  const context = useFilterEditorContext();

  return context?.updateFilter ?? updateFilter;
}
