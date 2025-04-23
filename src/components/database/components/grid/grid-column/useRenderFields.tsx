import { useReadOnly } from '@/application/database-yjs';
import { FieldVisibility } from '@/application/database-yjs/database.type';
import { useFieldsSelector } from '@/application/database-yjs/selector';
import { FieldId } from '@/application/types';
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
  isPrimary?: boolean;
};

export function useRenderFields () {
  const fields = useFieldsSelector();

  const readOnly = useReadOnly();
  const renderColumns = useMemo(() => {
    const data: RenderColumn[] = fields.map((column) => ({
      ...column,
      type: GridColumnType.Field,
    }));

    if (!readOnly) {
      data.push({
        type: GridColumnType.NewProperty,
        width: 150,
      });
      return data;
    }

    return data;
  }, [fields, readOnly]);

  return {
    fields: renderColumns,
  };
}
