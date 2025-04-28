import { FieldId, YjsDatabaseKey } from '@/application/types';
import { useFieldSelector } from '@/application/database-yjs';
import FieldCustomIcon from '@/components/database/components/field/FieldCustomIcon';
import { cn } from '@/lib/utils';
import React from 'react';

export function FieldDisplay ({ fieldId, ...props }: { fieldId: FieldId } & React.HTMLAttributes<HTMLDivElement>) {
  const { field } = useFieldSelector(fieldId);
  const name = field?.get(YjsDatabaseKey.name);

  if (!field) return null;

  return (
    <div {...props} className={cn('flex items-center gap-[10px]', props.className)}>
      <FieldCustomIcon fieldId={fieldId} />
      <div className={'flex-1 truncate'}>{name}</div>
    </div>
  );
}

export default FieldDisplay;
