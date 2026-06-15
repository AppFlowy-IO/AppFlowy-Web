/**
 * Calculation dispatch hooks
 *
 * Handles field calculation operations:
 * - useCalculateFieldDispatch: Calculate field value
 * - useUpdateCalculate: Update calculation type
 * - useClearCalculate: Clear calculation
 */

import { nanoid } from 'nanoid';
import { useCallback } from 'react';
import * as Y from 'yjs';

import { calculateFieldValue } from '@/application/database-yjs/calculation';
import { useDatabaseView, useSharedRoot } from '@/application/database-yjs/context';
import { CalculationType } from '@/application/database-yjs/database.type';
import { useFieldType } from '@/application/database-yjs/selector';
import { executeOperations } from '@/application/slate-yjs/utils/yjs';
import { YDatabaseCalculation, YDatabaseCalculations, YjsDatabaseKey } from '@/application/types';

export function useCalculateFieldDispatch(fieldId: string) {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();
  const fieldType = useFieldType(fieldId);

  return useCallback(
    (cells: Map<string, unknown>) => {
      const calculations = view?.get(YjsDatabaseKey.calculations);
      const index = (calculations?.toArray() || []).findIndex((calculation) => {
        return calculation.get(YjsDatabaseKey.field_id) === fieldId;
      });

      if (index === -1 || !calculations) {
        return;
      }

      const cellValues = Array.from(cells.values());

      const item = calculations.get(index);
      const type = Number(item.get(YjsDatabaseKey.type)) as CalculationType;
      const oldValue = item.get(YjsDatabaseKey.calculation_value) as string | number;

      const newValue = calculateFieldValue({
        fieldType,
        calculationType: type,
        cellValues,
      });

      if (newValue !== null && newValue !== oldValue) {
        executeOperations(
          sharedRoot,
          [
            () => {
              item.set(YjsDatabaseKey.calculation_value, newValue);
            },
          ],
          'calculateFieldDispatch'
        );
      }
    },
    [view, fieldId, fieldType, sharedRoot]
  );
}

export function useUpdateCalculate(fieldId: string) {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback(
    (type: CalculationType) => {
      if (!view) return;
      executeOperations(
        sharedRoot,
        [
          () => {
            let calculations = view?.get(YjsDatabaseKey.calculations);

            if (!calculations) {
              calculations = new Y.Array() as YDatabaseCalculations;
              view.set(YjsDatabaseKey.calculations, calculations);
            }

            let item = calculations.toArray().find((calculation) => {
              return calculation.get(YjsDatabaseKey.field_id) === fieldId;
            });

            if (!item) {
              item = new Y.Map() as YDatabaseCalculation;
              item.set(YjsDatabaseKey.id, nanoid(6));
              item.set(YjsDatabaseKey.field_id, fieldId);
              calculations.push([item]);
            }

            item.set(YjsDatabaseKey.type, type);
          },
        ],
        'updateCalculate'
      );
    },
    [fieldId, sharedRoot, view]
  );
}

export function useClearCalculate(fieldId: string) {
  const sharedRoot = useSharedRoot();
  const view = useDatabaseView();

  return useCallback(() => {
    executeOperations(
      sharedRoot,
      [
        () => {
          const calculations = view?.get(YjsDatabaseKey.calculations);

          if (!calculations) {
            throw new Error(`Calculations not found`);
          }

          const index = calculations.toArray().findIndex((calculation) => {
            return calculation.get(YjsDatabaseKey.field_id) === fieldId;
          });

          if (index !== -1) {
            calculations.delete(index);
          }
        },
      ],
      'clearCalculate'
    );
  }, [fieldId, sharedRoot, view]);
}
