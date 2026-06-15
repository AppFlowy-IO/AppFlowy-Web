import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseView, useFieldCellsSelector, useReadOnly } from '@/application/database-yjs';
import { CalculationType } from '@/application/database-yjs/database.type';
import { useCalculateFieldDispatch, useClearCalculate, useUpdateCalculate } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as DropdownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { CalculationCell, ICalculationCell } from '@/components/database/components/grid/grid-calculation-cell';
import CalcationMenu from '@/components/database/components/grid/grid-calculation-cell/CalcationMenu';
import { cn } from '@/lib/utils';

export interface GridCalculateRowCellProps {
  fieldId: string;
}

export function GridCalculateRowCell ({ fieldId }: GridCalculateRowCellProps) {
  const databaseView = useDatabaseView();
  const [calculation, setCalculation] = useState<ICalculationCell>();
  const readOnly = useReadOnly();
  const calculate = useCalculateFieldDispatch(fieldId);
  const { cells } = useFieldCellsSelector(fieldId);
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
    if (readOnly || !cells) return;

    calculate(cells);
  }, [cells, readOnly, calculate, calculation?.type]);

  const [isHovered, setHovered] = useState(false);

  const [open, setOpen] = useState(false);

  const updateCalculation = useUpdateCalculate(fieldId);
  const clearCalculation = useClearCalculate(fieldId);

  return <>
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
      className={cn(!readOnly && 'hover:cursor-pointer hover:bg-fill-content-hover', 'w-full relative h-full flex items-center justify-end')}
    >
      {!calculation && isHovered ? <div className={'flex items-center gap-1.5 text-text-secondary text-sm px-2'}>
        {t('grid.calculate')}
        <DropdownIcon className={'w-5 h-5'} />
      </div> : <CalculationCell cell={calculation} />}
      {!readOnly && (<CalcationMenu
        fieldId={fieldId}
        open={open}
        onOpenChange={setOpen}
        calculation={calculation}
        onClear={clearCalculation}
        onChangeType={updateCalculation}
      />)}

    </div>

  </>;
}

export default GridCalculateRowCell;
