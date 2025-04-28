import { FieldType, useCellSelector, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { FileMediaCellData, TextCell } from '@/application/database-yjs/cell.type';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as FileMediaSvg } from '@/assets/icons/attachment.svg';
import Cell from '@/components/database/components/cell/Cell';
import { PrimaryCell } from '@/components/database/components/cell/primary';
import React, { CSSProperties, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export function CardField ({ rowId, fieldId, editing, setEditing }: {
  editing: boolean;
  setEditing: (editing: boolean) => void;
  rowId: string; fieldId: string; index: number
}) {
  const { t } = useTranslation();
  const { field } = useFieldSelector(fieldId);
  const cell = useCellSelector({
    rowId,
    fieldId,
  });

  const readOnly = useReadOnly();
  const isPrimary = field?.get(YjsDatabaseKey.is_primary);

  const type = field?.get(YjsDatabaseKey.type);
  const style = useMemo(() => {
    const styleProperties: CSSProperties = {
      overflow: 'hidden',
      width: '100%',
      textAlign: 'left',
      minHeight: 20,
      display: 'flex',
      alignItems: 'center',
      fontSize: 12,
    };

    if (isPrimary || [FieldType.Relation, FieldType.SingleSelect, FieldType.MultiSelect].includes(Number(type))) {
      Object.assign(styleProperties, {
        breakWord: 'break-word',
        whiteSpace: 'normal',
        flexWrap: 'wrap',
      });
    } else {
      Object.assign(styleProperties, {
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      });
    }

    if (isPrimary) {
      Object.assign(styleProperties, {
        fontSize: '14px',
        fontWeight: 500,
        lineHeight: '20px',
      });
    }

    return styleProperties;
  }, [isPrimary, type]);

  if (isPrimary) {
    return (
      <PrimaryCell
        placeholder={t('grid.row.titlePlaceholder')}
        editing={editing}
        setEditing={setEditing}
        showDocumentIcon
        readOnly={readOnly}
        cell={cell as TextCell}
        rowId={rowId}
        fieldId={fieldId}
        style={style}
      />
    );
  }

  if (Number(type) === FieldType.Checkbox) {
    return (
      <div className={'flex items-center gap-1'}>
        <span>
          <Cell
            readOnly
            cell={cell || undefined}
            rowId={rowId}
            fieldId={fieldId}
          />
        </span>
        <span>{field?.get(YjsDatabaseKey.name) || ''}</span>
      </div>
    );
  }

  if (Number(type) === FieldType.FileMedia) {
    const count = (cell?.data as FileMediaCellData)?.length || 0;

    if (count === 0) return null;
    return (
      <div
        style={style}
        className={'flex cursor-text gap-1.5'}
      >
        <FileMediaSvg className={'h-4 w-4'} />
        {count}
      </div>
    );
  }

  return <Cell
    style={style}
    readOnly
    cell={cell || undefined}
    rowId={rowId}
    fieldId={fieldId}
  />;
}

export default CardField;
