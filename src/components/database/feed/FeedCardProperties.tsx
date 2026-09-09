import { memo } from 'react';

import { Column, useCellSelector } from '@/application/database-yjs';
import { ListCell } from '@/components/database/list/ListCell';

const propertyStyle = {
  fontSize: 12,
  lineHeight: '20px',
  minHeight: 20,
  maxWidth: '100%',
  overflow: 'hidden',
};

function FeedProperty({ field, rowId }: { field: Column; rowId: string }) {
  const cell = useCellSelector({ fieldId: field.fieldId, rowId });

  return (
    <div className='min-w-0 max-w-full' data-testid={`feed-field-${field.fieldId}-${rowId}`} title={field.fieldName}>
      <dt className='sr-only'>{field.fieldName}</dt>
      <dd className='min-w-0'>
        <ListCell cell={cell} field={field} rowId={rowId} style={propertyStyle} />
      </dd>
    </div>
  );
}

export const FeedCardProperties = memo(function FeedCardProperties({
  fields,
  primaryFieldId,
  rowId,
}: {
  fields: Column[];
  primaryFieldId: string;
  rowId: string;
}) {
  const properties = fields.filter((field) => field.fieldId !== primaryFieldId);

  if (properties.length === 0) return null;

  return (
    <dl
      className='mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1'
      data-feed-interactive='true'
      data-testid={`feed-card-properties-${rowId}`}
      onClick={(event) => event.stopPropagation()}
    >
      {properties.map((field) => (
        <FeedProperty field={field} key={field.fieldId} rowId={rowId} />
      ))}
    </dl>
  );
});
