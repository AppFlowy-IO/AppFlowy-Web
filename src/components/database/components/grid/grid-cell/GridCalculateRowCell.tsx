import { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Row, useDatabaseView, useFieldCellsByRowsSelector, useReadOnly } from '@/application/database-yjs';
import { CalculationType } from '@/application/database-yjs/database.type';
import { useCalculateFieldDispatch, useClearCalculate, useUpdateCalculate } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as DropdownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { CalculationCell, ICalculationCell } from '@/components/database/components/grid/grid-calculation-cell';
import CalcationMenu from '@/components/database/components/grid/grid-calculation-cell/CalcationMenu';
import { GridContext } from '@/components/database/grid/useGridContext';
import { cn } from '@/lib/utils';

export interface GridCalculateRowCellProps {
  fieldId: string;
  /** Rows to calculate over; defaults to the surrounding grid's rows. */
  rowOrders?: Row[];
}

export function GridCalculateRowCell({ fieldId, rowOrders: rowOrdersProp }: GridCalculateRowCellProps) {
  const gridRowOrders = useContext(GridContext)?.rowOrders;
  const rowOrders = rowOrdersProp ?? gridRowOrders;
  const { cells } = useFieldCellsByRowsSelector(fieldId, rowOrders);

  return <GridCalculateRowCellWithValues fieldId={fieldId} cells={cells} ready />;
}

export interface GridCalculateRowCellWithValuesProps {
  fieldId: string;
  cells: Map<string, unknown> | null;
  /** Partial snapshots must not overwrite the persisted aggregate. */
  ready: boolean;
}

/** Shared calculation controls for callers that load complete row snapshots. */
export function GridCalculateRowCellWithValues({ fieldId, cells, ready }: GridCalculateRowCellWithValuesProps) {
  const databaseView = useDatabaseView();
  const [calculation, setCalculation] = useState<ICalculationCell>();
  const readOnly = useReadOnly();
  const calculate = useCalculateFieldDispatch(fieldId);
  const calculations = databaseView?.get(YjsDatabaseKey.calculations);

  const { t } = useTranslation();
  const handleObserver = useCallback(() => {
    if (!calculations) return;
    if (calculations.length === 0) {
      setCalculation(undefined);
      return;
    }

    const item = calculations.toArray().find((calculation) => calculation.get(YjsDatabaseKey.field_id) === fieldId);

    if (!item) {
      setCalculation(undefined);
      return;
    }

    setCalculation({
      id: item.get(YjsDatabaseKey.id),
      fieldId: item.get(YjsDatabaseKey.field_id),
      value: String(item.get(YjsDatabaseKey.calculation_value) ?? ''),
      type: Number(item.get(YjsDatabaseKey.type)) as CalculationType,
    });
  }, [calculations, fieldId]);

  useEffect(() => {
    const observerHandle = () => {
      handleObserver();
    };

    observerHandle();
    calculations?.observeDeep(handleObserver);

    return () => {
      calculations?.unobserveDeep(handleObserver);
    };
  }, [calculations, fieldId, handleObserver]);

  useEffect(() => {
    if (readOnly || !ready || !cells) return;

    calculate(cells);
  }, [cells, readOnly, ready, calculate, calculation?.type]);

  const [isHovered, setHovered] = useState(false);

  const [open, setOpen] = useState(false);

  const updateCalculation = useUpdateCalculate(fieldId);
  const clearCalculation = useClearCalculate(fieldId);

  return (
    <>
      <div
        onMouseEnter={() => {
          if (readOnly) return;
          setHovered(true);
        }}
        onMouseLeave={() => {
          setHovered(false);
        }}
        onClick={() => {
          if (readOnly) return;
          setOpen(true);
        }}
        data-testid={`grid-calculate-cell-${fieldId}`}
        className={cn(
          !readOnly && 'hover:cursor-pointer hover:bg-fill-content-hover',
          'relative flex h-full w-full items-center justify-end'
        )}
      >
        {!calculation && isHovered ? (
          <div className={'flex items-center gap-1.5 px-2 text-sm text-text-secondary'}>
            {t('grid.calculate')}
            <DropdownIcon className={'h-5 w-5'} />
          </div>
        ) : (
          <CalculationCell cell={calculation} />
        )}
        {!readOnly && (
          <CalcationMenu
            fieldId={fieldId}
            open={open}
            onOpenChange={setOpen}
            calculation={calculation}
            onClear={clearCalculation}
            onChangeType={updateCalculation}
          />
        )}
      </div>
    </>
  );
}

export default GridCalculateRowCell;
