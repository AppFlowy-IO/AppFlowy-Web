/**
 * Safe wrappers around `window.localStorage`.
 *
 * Direct `localStorage` access throws in several real-world conditions:
 * - Safari private browsing (`SecurityError` / `QuotaExceededError`)
 * - blocked third-party storage / disabled cookies
 * - quota exceeded after large Yjs / cache writes
 * - SSR / workers where `window` is undefined
 *
 * These helpers never throw. Reads fall back to the provided default,
 * writes are best-effort. See `src/utils/database-view-order.ts` for the
 * prior art this generalizes (`readStoredViewOrder` / `writeStoredViewOrder`).
 */

export const OUTLINE_WIDTH_KEY = 'outline_width';
export const OUTLINE_OPEN_KEY = 'outline_open';
export const DEFAULT_OUTLINE_WIDTH = 268;

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function safeGetItem(key: string): string | null {
  if (!hasStorage()) return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: string): boolean {
  if (!hasStorage()) return false;

  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemoveItem(key: string): boolean {
  if (!hasStorage()) return false;

  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function safeGetInt(key: string, fallback: number): number {
  const raw = safeGetItem(key);

  if (raw === null || raw.trim() === '') return fallback;

  const parsed = parseInt(raw, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
}

export function safeGetBoolean(key: string, fallback = false): boolean {
  const raw = safeGetItem(key);

  if (raw === null) return fallback;

  if (raw === 'true') return true;
  if (raw === 'false') return false;

  return fallback;
}

export function getOutlineWidth(fallback: number = DEFAULT_OUTLINE_WIDTH): number {
  const width = safeGetInt(OUTLINE_WIDTH_KEY, fallback);

  return width > 0 ? width : fallback;
}

export function setOutlineWidth(width: number): boolean {
  if (!Number.isFinite(width) || width <= 0) return false;

  return safeSetItem(OUTLINE_WIDTH_KEY, String(width));
}

export function getOutlineOpen(fallback = false): boolean {
  return safeGetBoolean(OUTLINE_OPEN_KEY, fallback);
}

export function setOutlineOpen(open: boolean): boolean {
  return safeSetItem(OUTLINE_OPEN_KEY, String(open));
}

export function getLastViewId(workspaceId: string, userUuid: string): string | null {
  if (!workspaceId || !userUuid) return null;

  return safeGetItem(`last_view_id_${workspaceId}_${userUuid}`);
}

export function setLastViewId(workspaceId: string, userUuid: string, viewId: string): boolean {
  if (!workspaceId || !userUuid || !viewId) return false;

  return safeSetItem(`last_view_id_${workspaceId}_${userUuid}`, viewId);
}
