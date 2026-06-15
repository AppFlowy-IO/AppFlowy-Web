import { nanoid } from 'nanoid';

const DEVICE_ID_STORAGE_KEY = 'x-device-id';

let memoizedDeviceId: string | undefined;

/**
 * Returns a stable device ID for the current browser profile.
 * Falls back to an in-memory ID if localStorage is unavailable.
 */
export function getOrCreateDeviceId(): string {
  if (memoizedDeviceId) {
    return memoizedDeviceId;
  }

  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);

      if (stored) {
        memoizedDeviceId = stored;
        return stored;
      }

      const created = nanoid(8);

      window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
      memoizedDeviceId = created;
      return created;
    } catch {
      // Fall back to memory-only device id below.
    }
  }

  memoizedDeviceId = nanoid(8);
  return memoizedDeviceId;
}
