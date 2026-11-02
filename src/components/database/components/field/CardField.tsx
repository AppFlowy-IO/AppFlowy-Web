import { ComponentProps, CSSProperties, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { Cell as CellType, TextCell } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { getChecked } from '@/application/database-yjs/fields/checkbox/utils';
import { countFileMediaItems } from '@/application/database-yjs/fields/media/parse';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as FileMediaSvg } from '@/assets/icons/attachment.svg';
import { Cell, CellValue } from '@/components/database/components/cell/Cell';
import { PrimaryCell } from '@/components/database/components/cell/primary';
import { cn } from '@/lib/utils';

/** The title field of a card; only it translates (its placeholder), not every field (W8). */
function PrimaryCardField(props: Omit<ComponentProps<typeof PrimaryCell>, 'placeholder'>) {
  const { t } = useTranslation();

  return <PrimaryCell placeholder={t('grid.row.titlePlaceholder')} {...props} />;
}

export function CardField({
  rowId,
  fieldId,
  editing,
  setEditing,
}: {
  editing?: boolean;
  setEditing?: (editing: boolean) => void;
  rowId: string;
  fieldId: string;
  index?: number;
}) {
  const { field } = useFieldSelector(fieldId);
  const readOnly = useReadOnly();
  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);

  const isPrimary = field?.get(YjsDatabaseKey.is_primary);
  const fieldName = field?.get(YjsDatabaseKey.name) || '';

  const type = field?.get(YjsDatabaseKey.type);
  const style = useMemo(() => {
    const styleProperties: CSSProperties = {
      textAlign: 'left',
      minHeight: 20,
      display: 'flex',
      alignItems: 'center',
      fontSize: 12,
      maxWidth: '100%',
      cursor: readOnly ? 'default' : 'pointer',
    };

    if (isPrimary) {
      Object.assign(styleProperties, {
        fontSize: '14px',
        fontWeight: 500,
        lineHeight: '20px',
      });
    }

    return styleProperties;
  }, [isPrimary, readOnly]);

  const renderCell = useCallback(
    (cell: CellType | undefined) => {
      if (isPrimary) {
        return (
          <PrimaryCardField
            editing={editing}
            setEditing={setEditing}
            readOnly={readOnly}
            cell={cell as TextCell}
            rowId={rowId}
            fieldId={fieldId}
            style={style}
            wrap
          />
        );
      }

      // Even the data is empty, we still need to show the checkbox
      if (Number(type) === FieldType.Checkbox) {
        return (
          <div
            onClick={(e) => {
              if (readOnly) return;
              e.stopPropagation();

              void onUpdateCell(getChecked(cell?.data as string) ? 'No' : 'Yes');
            }}
            className={'flex items-center gap-2'}
          >
            <span className={cn(readOnly ? '' : 'cursor-pointer rounded-100 hover:bg-fill-content-hover')}>
              <Cell readOnly={readOnly} cell={cell || undefined} rowId={rowId} fieldId={fieldId} wrap />
            </span>
            <span>{fieldName}</span>
          </div>
        );
      }

      if (
        [FieldType.LastEditedTime, FieldType.CreatedTime, FieldType.CreatedBy, FieldType.LastEditedBy].includes(
          Number(type)
        )
      ) {
        return <Cell style={style} readOnly rowId={rowId} fieldId={fieldId} wrap />;
      }

      if (!cell || !cell.data) {
        return null;
      }

      if (Number(type) === FieldType.Media) {
        const count = countFileMediaItems(cell?.data);

        if (count === 0) return null;
        return (
          <div style={style} className={'flex cursor-text gap-1.5'}>
            <FileMediaSvg className={'h-4 w-4'} />
            {count}
          </div>
        );
      }

      return <Cell style={style} readOnly cell={cell || undefined} rowId={rowId} fieldId={fieldId} wrap isCardCell />;
    },
    [editing, fieldId, fieldName, isPrimary, onUpdateCell, readOnly, rowId, setEditing, style, type]
  );

  return (
    <CellValue rowId={rowId} fieldId={fieldId} fieldType={Number(type) as FieldType}>
      {renderCell}
    </CellValue>
  );
}

/** A board card renders one per shown field; it re-renders only when its own props or data change. */
export default memo(CardField);
