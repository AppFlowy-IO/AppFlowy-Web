import { useEffect, useState } from 'react';

import { useDatabaseView } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';

const EMPTY: ReadonlyMap<string, number> = new Map();

function sameWidths(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>) {
  if (a.size !== b.size) return false;
  for (const [fieldId, width] of a) {
    if (b.get(fieldId) !== width) return false;
  }

  return true;
}

/**
 * Widths this view actually stored. `useFieldsSelector` fills unset widths with
 * the grid's default, which would hide the timeline's own column defaults.
 */
export function useTimelineSavedColumnWidths(): ReadonlyMap<string, number> {
  const view = useDatabaseView();
  const [widths, setWidths] = useState<ReadonlyMap<string, number>>(EMPTY);

  useEffect(() => {
    const read = () => {
      const fieldSettings = view?.get(YjsDatabaseKey.field_settings);
      const next = new Map<string, number>();

      fieldSettings?.forEach((_, fieldId) => {
        const width = parseInt(fieldSettings.get(fieldId)?.get(YjsDatabaseKey.width));

        if (Number.isFinite(width) && width > 0) next.set(fieldId, width);
      });
      setWidths((current) => (sameWidths(current, next) ? current : next));
    };

    // Remote updates can insert or replace the settings map itself.
    view?.observeDeep(read);
    read();
    return () => view?.unobserveDeep(read);
  }, [view]);

  return widths;
}
