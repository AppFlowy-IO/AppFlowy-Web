import { isEqual } from 'lodash-es';
import { FC, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { CellProps, Cell as CellType } from '@/application/database-yjs/cell.type';
import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { useCellSelector, useFieldSelector, useRowDataSelector } from '@/application/database-yjs/selector';
import { YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { AITextCell } from '@/components/database/components/cell/ai-text/AITextCell';
import { AttributionCell } from '@/components/database/components/cell/attribution';
import { CheckboxCell } from '@/components/database/components/cell/checkbox';
import { ChecklistCell } from '@/components/database/components/cell/checklist';
import { RowCreateModifiedTime } from '@/components/database/components/cell/created-modified';
import { DateTimeCell } from '@/components/database/components/cell/date';
import { FormulaCell } from '@/components/database/components/cell/formula';
import { NumberCell } from '@/components/database/components/cell/number';
import { RelationCell } from '@/components/database/components/cell/relation';
import { RollupCell } from '@/components/database/components/cell/rollup';
import { SelectOptionCell } from '@/components/database/components/cell/select-option';
import { TextCell } from '@/components/database/components/cell/text';
import { isFieldEditingDisabled } from '@/components/database/utils/field-editing';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { FileMediaCell } from 'src/components/database/components/cell/file-media';

import { PersonCell } from './person';

/** Rollup and Formula cells compute their value; every other cell reads it from the row. */
export function isComputedCellType(fieldType: FieldType) {
  return fieldType === FieldType.Rollup || fieldType === FieldType.Formula;
}

function yjsEventChangesKey(event: unknown, key: string) {
  return (event as { keysChanged?: Set<unknown> }).keysChanged?.has(key) ?? false;
}

/**
 * The value a cell stores in its row: `useCellSelector` without the rollup
 * and formula hooks. `useCellSelector` runs both for every cell whatever its
 * field type, and the rollup hook resets its state once on mount, which
 * renders every cell a second time (W17, W15). Keep it in step with the
 * stored-value part of `useCellSelector`.
 */
export function useStoredCellValue({ rowId, fieldId }: { rowId: string; fieldId: string }): CellType | undefined {
  const { row: boundRow } = useRowDataSelector(rowId);
  const context = useDatabaseContextOptional();
  const seedsReady = context?.getRowPassState?.().seedsReady ?? context?.seedsReady;
  // A board groups the source's seed rows before its visible cards bind live
  // documents. Render those existing values immediately so a tall card is
  // measured at its real height on its first paint. Edits still use ensureRow
  // and the writable row map; historical rows never consult a live seed.
  const seedRow =
    !boundRow && seedsReady && context?.dataSource?.type !== 'history'
      ? context?.peekRowDocFromSeed?.(rowId)?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)
      : undefined;
  const row = boundRow ?? seedRow;
  const cells = row?.get(YjsDatabaseKey.cells);
  const { field, clock: fieldClock } = useFieldSelector(fieldId);
  const cell = cells?.get(fieldId);
  const [clock, setClock] = useState<number>(0);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;

  const cellValue = useMemo(() => {
    return cell ? parseYDatabaseCellToCell(cell, field) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell, field, fieldType, fieldClock, clock]);

  const cellValueRef = useRef(cellValue);

  cellValueRef.current = cellValue;

  useEffect(() => {
    if (!cells) return;

    const bump = () => {
      setClock((prev) => prev + 1);
    };

    const onCellsChange = (event: unknown) => {
      if (yjsEventChangesKey(event, fieldId)) bump();
    };

    cells.observe(onCellsChange);
    cell?.observeDeep(bump);

    // A mutation between render and this effect is reported by nothing:
    // render once more when the value the UI rendered is already stale.
    const current = cells.get(fieldId);
    const fresh = current ? parseYDatabaseCellToCell(current, field) : undefined;

    if (!isEqual(fresh, cellValueRef.current)) {
      bump();
    }

    return () => {
      cells.unobserve(onCellsChange);
      cell?.unobserveDeep(bump);
    };
  }, [cells, cell, field, fieldId]);

  return cellValue;
}

type CellValueProps = {
  rowId: string;
  fieldId: string;
  /** The live field type: a change of type switches the reader. */
  fieldType: FieldType;
  children: (cell: CellType | undefined) => ReactNode;
};

/**
 * The rendered cell is kept while its value and render function are: the row
 * and field hooks re-render their component on mount, and the cell component
 * below then keeps its first render (W15).
 */
function useRenderedCell(children: CellValueProps['children'], cell: CellType | undefined) {
  return useMemo(() => children(cell), [children, cell]);
}

function StoredCellValue({ rowId, fieldId, children }: Omit<CellValueProps, 'fieldType'>) {
  return <>{useRenderedCell(children, useStoredCellValue({ rowId, fieldId }))}</>;
}

function ComputedCellValue({ rowId, fieldId, children }: Omit<CellValueProps, 'fieldType'>) {
  return <>{useRenderedCell(children, useCellSelector({ rowId, fieldId }))}</>;
}

/**
 * Reads a cell's value with the hooks its field type needs and renders it:
 * only Rollup and Formula cells run the rollup and formula hooks (W17). Pass
 * a memoized `children`: the cell renders again only when it or the value
 * changes.
 */
export function CellValue({ fieldType, ...props }: CellValueProps) {
  return isComputedCellType(fieldType) ? <ComputedCellValue {...props} /> : <StoredCellValue {...props} />;
}

/** Translated texts render in their own components, so a cell subscribes to no translation (W8). */
function HistoryValueUnavailable() {
  const { t } = useTranslation();

  return (
    <span className='text-text-tertiary'>{t('databaseHistory.valueUnavailable', 'Unavailable in this version')}</span>
  );
}

function EditNotSupportedText() {
  const { t } = useTranslation();

  return <>{t('common.editNotSupported')}</>;
}

export function Cell(props: CellProps<CellType>) {
  const { rowId, fieldId, style, wrap, isHovering } = props;
  const { field } = useFieldSelector(fieldId);
  const context = useDatabaseContextOptional();
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const disableRelationRollupEdit = isFieldEditingDisabled(fieldType);

  const Component = useMemo(() => {
    switch (fieldType) {
      case FieldType.RichText:
      case FieldType.URL:
        return TextCell;
      case FieldType.Number:
        return NumberCell;
      case FieldType.Checkbox:
        return CheckboxCell;
      case FieldType.SingleSelect:
      case FieldType.MultiSelect:
        return SelectOptionCell;
      case FieldType.DateTime:
        return DateTimeCell;
      case FieldType.Checklist:
        return ChecklistCell;
      case FieldType.Relation:
        return RelationCell;
      case FieldType.Media:
        return FileMediaCell;
      case FieldType.Summary:
      case FieldType.Translate:
        return AITextCell;
      case FieldType.Person:
        return PersonCell;
      case FieldType.Rollup:
        return RollupCell;
      case FieldType.Formula:
        return FormulaCell;
      default:
        return TextCell;
    }
  }, [fieldType]) as FC<CellProps<CellType>>;

  if (fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime) {
    const attrName = fieldType === FieldType.CreatedTime ? YjsDatabaseKey.created_at : YjsDatabaseKey.last_modified;

    return (
      <RowCreateModifiedTime
        style={style}
        rowId={rowId}
        fieldId={fieldId}
        attrName={attrName}
        wrap={wrap}
        isHovering={isHovering}
      />
    );
  }

  if (fieldType === FieldType.CreatedBy || fieldType === FieldType.LastEditedBy) {
    return <AttributionCell {...props} readOnly editing={false} setEditing={undefined} />;
  }

  if (fieldType === FieldType.Rollup && context?.dataSource?.type === 'history' && !props.cell?.data) {
    return <HistoryValueUnavailable />;
  }

  const cellProps =
    disableRelationRollupEdit || context?.readOnly
      ? {
          ...props,
          readOnly: true,
          editing: false,
          setEditing: undefined,
        }
      : props;

  const content = <Component {...cellProps} />;

  if (disableRelationRollupEdit) {
    return (
      <Tooltip delayDuration={500} disableHoverableContent>
        <TooltipTrigger asChild>
          <div className='h-full min-h-[20px] w-full flex-1 self-stretch'>{content}</div>
        </TooltipTrigger>
        <TooltipContent side='top'>
          <EditNotSupportedText />
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

export default Cell;
