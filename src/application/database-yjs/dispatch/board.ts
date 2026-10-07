import { useCallback } from 'react';
import * as Y from 'yjs';

import { GROUP_CALCULATION_COUNT_ALL, GROUP_CALCULATION_KEY } from '@/application/database-yjs/board-group-calculation';
import { useDatabaseView, useSharedRoot } from '@/application/database-yjs/context';
import { CalculationType } from '@/application/database-yjs/database.type';
import { executeDatabaseOperations as executeOperations } from '@/application/database-yjs/history';
import {
  YDatabaseBoardLayoutSetting,
  YDatabaseLayoutSettings,
  YDatabaseView,
  YjsDatabaseKey,
} from '@/application/types';

/** The board layout map (`layout_settings["1"]`), created when absent. */
function getOrCreateBoardLayoutMap(view: YDatabaseView): YDatabaseBoardLayoutSetting {
  let layoutSettings = view.get(YjsDatabaseKey.layout_settings);

  if (!layoutSettings) {
    layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
    view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  }

  let layoutSetting = layoutSettings.get('1');

  if (!layoutSetting) {
    layoutSetting = new Y.Map() as YDatabaseBoardLayoutSetting;
    layoutSettings.set('1', layoutSetting);
  }

  return layoutSetting;
}

/**
 * Writes the given keys of a board layout map one by one: every other key,
 * including ones this client does not know, stays as it is
 * (`layouts/board-settings.json` write cases).
 */
export function writeBoardLayoutKeys(layoutSetting: Y.Map<unknown>, write: Record<string, unknown>) {
  Object.entries(write).forEach(([key, value]) => layoutSetting.set(key, value));
}

/** The persisted `group_calculation` of a calculation; Count all is `{type: 5, field_id: ""}`. */
export function groupCalculationValue(calculation: { type: CalculationType; fieldId: string } | null) {
  if (!calculation || calculation.type === CalculationType.Count) return { ...GROUP_CALCULATION_COUNT_ALL };
  return { type: calculation.type, field_id: calculation.fieldId };
}

/** "Color columns": writes `show_color_columns` only (WP09 §1.5). */
export function useToggleBoardColorColumns() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (showColorColumns: boolean) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) throw new Error('View not found');
            writeBoardLayoutKeys(getOrCreateBoardLayoutMap(view), {
              [YjsDatabaseKey.show_color_columns]: showColorColumns,
            });
          },
        ],
        'toggleBoardColorColumns'
      );
    },
    [sharedRoot, view]
  );
}

/**
 * The board-wide column calculation (WP09 §1.6): writes the whole
 * `group_calculation` object, `null` (or Count) for Count all.
 */
export function useSetBoardGroupCalculation() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (calculation: { type: CalculationType; fieldId: string } | null) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) throw new Error('View not found');
            writeBoardLayoutKeys(getOrCreateBoardLayoutMap(view), {
              [GROUP_CALCULATION_KEY]: groupCalculationValue(calculation),
            });
          },
        ],
        'setBoardGroupCalculation'
      );
    },
    [sharedRoot, view]
  );
}
