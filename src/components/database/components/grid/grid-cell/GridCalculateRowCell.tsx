import { useCalculateFieldDispatch } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { useDatabaseView, useFieldCellsSelector, useReadOnly } from '@/application/database-yjs';
import { CalculationType } from '@/application/database-yjs/database.type';
import { CalculationCell, ICalculationCell } from '@/components/database/components/grid/grid-calculation-cell';
import React, { useCallback, useEffect, useState } from 'react';

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

  const handleObserver = useCallback(() => {
    if (!calculations) return;
    calculations.forEach((calculation) => {
      if (calculation.get(YjsDatabaseKey.field_id) === fieldId) {
        setCalculation({
          id: calculation.get(YjsDatabaseKey.id),
          fieldId: calculation.get(YjsDatabaseKey.field_id),
          value: calculation.get(YjsDatabaseKey.calculation_value),
          type: Number(calculation.get(YjsDatabaseKey.type)) as CalculationType,
        });
      }
    });
  }, [calculations, fieldId]);

  useEffect(() => {
    const observerHandle = () => {
      handleObserver();
    };

    observerHandle();
    calculations?.observeDeep(handleObserver);

    return () => {
      calculations?.observeDeep(handleObserver);
    };
  }, [calculations, fieldId, handleObserver]);

  useEffect(() => {
    if (readOnly || !cells) return;

    calculate(cells);
  }, [cells, readOnly, calculate]);

  return <CalculationCell cell={calculation} />;
}

export default GridCalculateRowCell;
