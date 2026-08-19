import { YDatabase, YDoc, YjsEditorKey } from '@/application/types';

const DATABASE_HYDRATION_TIMEOUT_MS = 3000;

function getDatabase(doc: YDoc): YDatabase | null {
  return (doc.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database) as YDatabase | undefined) ?? null;
}

/**
 * Wait until an opened database collab contains its `database` payload.
 *
 * `loadView` resolves as soon as a doc exists locally, which for a related
 * database that has never been opened can be an empty shell while the first
 * sync is still in flight. Callers that read the doc once — creating a
 * reciprocal field, say — would otherwise see "no database" and silently take
 * their failure path.
 */
export function waitForDatabaseHydration(
  databaseDoc: YDoc,
  timeoutMs = DATABASE_HYDRATION_TIMEOUT_MS
): Promise<YDatabase | null> {
  const existing = getDatabase(databaseDoc);

  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: YDatabase | null) => {
      if (settled) return;
      settled = true;
      databaseDoc.off('update', listener);
      clearTimeout(timer);
      resolve(value);
    };

    const listener = () => {
      const database = getDatabase(databaseDoc);

      if (database) finish(database);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    databaseDoc.on('update', listener);
  });
}
