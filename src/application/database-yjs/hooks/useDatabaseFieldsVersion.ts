import { useEffect, useState } from 'react';

import { useDatabaseFields } from '@/application/database-yjs/context';

/**
 * Returns a monotonically increasing version number that bumps every time
 * the database's `fields` map mutates (add, remove, rename, type change).
 *
 * The Y.Map returned by `useDatabaseFields` is identity-stable across
 * mutations, so memos keyed on `fields` alone never re-run. Include the
 * value of this hook in the dep array to opt in to invalidation.
 */
export function useDatabaseFieldsVersion(): number {
  const fields = useDatabaseFields();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!fields) return;
    const bump = () => setVersion((v) => v + 1);

    fields.observeDeep(bump);
    return () => {
      fields.unobserveDeep(bump);
    };
  }, [fields]);

  return version;
}
