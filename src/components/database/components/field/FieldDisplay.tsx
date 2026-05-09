import { FieldType, useFieldSelector } from '@/application/database-yjs';
import { FieldId, YjsDatabaseKey } from '@/application/types';
import FieldCustomIcon from '@/components/database/components/field/FieldCustomIcon';
import { useRelationData } from '@/components/database/components/property/relation/useRelationData';
import { cn } from '@/lib/utils';

import type { HTMLAttributes } from 'react';

type FieldDisplayProps = {
  fieldId: FieldId;
  showPropertyName?: boolean;
  showRelationDatabaseName?: boolean;
} & HTMLAttributes<HTMLDivElement>;

function RelationDatabaseName({ fieldId }: { fieldId: FieldId }) {
  const { selectedView } = useRelationData(fieldId);

  if (!selectedView?.name) return null;

  return <span className={'ml-1 text-text-tertiary'}>{`· ${selectedView.name}`}</span>;
}

export function FieldDisplay({
  fieldId,
  showPropertyName = true,
  showRelationDatabaseName = false,
  ...props
}: FieldDisplayProps) {
  const { field } = useFieldSelector(fieldId);
  const name = field?.get(YjsDatabaseKey.name);
  const type = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const isRelation = type === FieldType.Relation;

  if (!field) return null;

  return (
    <div {...props} className={cn('flex items-center gap-[10px]', props.className)}>
      <FieldCustomIcon fieldId={fieldId} />
      {showPropertyName && (
        <div className={'flex-1 truncate'}>
          {name}
          {showRelationDatabaseName && isRelation ? <RelationDatabaseName fieldId={fieldId} /> : null}
        </div>
      )}
    </div>
  );
}

export default FieldDisplay;
