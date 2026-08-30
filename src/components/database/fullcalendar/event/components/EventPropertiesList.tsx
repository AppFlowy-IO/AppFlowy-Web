import { Column } from '@/application/database-yjs';
import CardField from '@/components/database/components/field/CardField';

interface EventPropertiesListProps {
  rowId: string;
  showFields?: Column[];
}

export function EventPropertiesList({ rowId, showFields }: EventPropertiesListProps) {
  if (!showFields || showFields.length === 0) return null;

  // Cap to first 5 fields to prevent dense calendar views from becoming too tall/noisy
  const displayedFields = showFields.slice(0, 5);

  return (
    <div className='event-properties mt-1 flex flex-col gap-1 w-full overflow-hidden px-1 pb-1'>
      {displayedFields.map((field) => (
        <CardField
          key={field.fieldId}
          rowId={rowId}
          fieldId={field.fieldId}
        />
      ))}
    </div>
  );
}
