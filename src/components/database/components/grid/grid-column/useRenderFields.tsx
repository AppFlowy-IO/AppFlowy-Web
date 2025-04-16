import { FieldId } from '@/application/types';
import { FieldVisibility } from '@/application/database-yjs/database.type';
import { useFieldsSelector } from '@/application/database-yjs/selector';
import { useMemo } from 'react';

export enum GridColumnType {
  Field,
  NewProperty,
}

export type RenderColumn = {
  type: GridColumnType;
  visibility?: FieldVisibility;
  fieldId?: FieldId;
  width: number;
  wrap?: boolean;
};

export function useRenderFields () {
  const fields = useFieldsSelector();

  console.log('useRenderFields ', fields);
  const renderColumns = useMemo(() => {
    const data = fields.map((column) => ({
      ...column,
      type: GridColumnType.Field,
    }));

    return [
      ...data,
      {
        type: GridColumnType.NewProperty,
        width: 150,
      },
    ].filter(Boolean) as RenderColumn[];
  }, [fields]);

  return {
    fields: renderColumns,
  };
}
