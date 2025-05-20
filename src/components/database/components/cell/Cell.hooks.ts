import { useFieldSelector } from '@/application/database-yjs/selector';
import { getTypeOptions } from '@/application/database-yjs';
import { useMemo } from 'react';

export function useFieldTypeOption (fieldId: string) {
  const { field } = useFieldSelector(fieldId);

  return useMemo(() => {
    return getTypeOptions(field);
  }, [field]);
}
