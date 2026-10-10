import Dexie from 'dexie';

import { databasePrefix } from '@/application/constants';

// This is a browser layout preference, shared across rows and workspaces. Keep
// it outside collaborative document data and the disposable document cache.
const preferences = new Dexie(`${databasePrefix}_preferences`);

preferences.version(1).stores({ layout: 'key' });

const layout = preferences.table<{ key: string; value: unknown }, string>('layout');
const key = 'side_peek_width';
const isWidth = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export async function loadSidePeekWidth(): Promise<number | undefined> {
  try {
    const value = (await layout.get(key))?.value;

    return isWidth(value) ? value : undefined;
  } catch {
    // Blocked or unavailable IndexedDB must not prevent opening a row.
    return undefined;
  }
}

export async function saveSidePeekWidth(width: number): Promise<void> {
  if (!isWidth(width)) return;
  try {
    await layout.put({ key, value: width });
  } catch {
    // Resizing still works in memory when browser storage cannot be written.
  }
}
