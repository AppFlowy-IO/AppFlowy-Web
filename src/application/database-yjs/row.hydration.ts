import { YDoc, YjsEditorKey } from '@/application/types';

const ROW_HYDRATION_TIMEOUT_MS = 3000;

function hasDatabaseRow(rowDoc: YDoc): boolean {
  return rowDoc.getMap(YjsEditorKey.data_section).has(YjsEditorKey.database_row);
}

/** Wait until an opened row collab contains its database_row payload. */
export function waitForDatabaseRowHydration(
  rowDoc: YDoc,
  timeoutMs = ROW_HYDRATION_TIMEOUT_MS
): Promise<YDoc | null> {
  if (hasDatabaseRow(rowDoc)) return Promise.resolve(rowDoc);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: YDoc | null) => {
      if (settled) return;
      settled = true;
      rowDoc.off('update', listener);
      clearTimeout(timer);
      resolve(value);
    };

    const listener = () => {
      if (hasDatabaseRow(rowDoc)) finish(rowDoc);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    rowDoc.on('update', listener);
  });
}
