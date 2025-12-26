import { useEffect, useState } from 'react';

import { useDatabaseFields } from '@/application/database-yjs';
import { isNumericRollupField } from '@/application/database-yjs/rollup/utils';

export function useRollupSortableIds() {
  const fields = useDatabaseFields();
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!fields) {
      setIds(new Set());
      return;
    }

    const update = () => {
      const next = new Set<string>();

      fields.forEach((field, id) => {
        if (isNumericRollupField(field)) {
          next.add(id);
        }
      });
      setIds(next);
    };

    update();
    fields.observeDeep(update);

    return () => {
      fields.unobserveDeep(update);
    };
  }, [fields]);

  return ids;
}
