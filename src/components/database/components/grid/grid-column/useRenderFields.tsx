import { useMemo } from 'react';

import { FieldType, isAIFieldType, useReadOnly } from '@/application/database-yjs';
import { FieldVisibility } from '@/application/database-yjs/database.type';
import { useFieldsSelector } from '@/application/database-yjs/selector';
import { FieldId } from '@/application/types';
import { useAIEnabled } from '@/components/app/app.hooks';

export enum GridColumnType {
  Field,
  NewProperty,
}

export type RenderColumn = {
  type: GridColumnType;
  visibility?: FieldVisibility;
  fieldId?: FieldId;
  fieldType?: FieldType;
  width: number;
  wrap?: boolean;
  isPrimary?: boolean;
};

export function useRenderFields () {
  const fields = useFieldsSelector();
  const aiEnabled = useAIEnabled();

  const readOnly = useReadOnly();
  const renderColumns = useMemo(() => {
    const data: RenderColumn[] = fields
      .filter((column) => aiEnabled || !isAIFieldType(column.fieldType))
      .map((column) => ({
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
  }, [aiEnabled, fields, readOnly]);

  return {
    fields: renderColumns,
  };
}
