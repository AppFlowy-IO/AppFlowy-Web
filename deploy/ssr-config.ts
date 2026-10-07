import { isKillSwitchOn, parseNamespaceAllowlist } from './indexing-policy';

export const DEFAULT_SNAPSHOT_TIMEOUT_MS = 1500;
const MIN_SNAPSHOT_TIMEOUT_MS = 100;
const MAX_SNAPSHOT_TIMEOUT_MS = 5000;

export const DEFAULT_MAX_INLINE_BYTES = 1024 * 1024;

export interface SsrSettings {
  /**
   * Upstream budget for SSR: the snapshot must arrive within it (else the shell
   * is served), and link lookups get whatever it leaves.
   */
  snapshotTimeoutMs: number;
  /**
   * Largest snapshot (serialized JSON, in bytes) inlined into the page for the
   * client to reuse. Larger snapshots are still server-rendered, but the client
   * fetches them itself, so a huge document does not double the HTML size.
   */
  maxInlineBytes: number;
}

const parsePositiveInt = (raw: string | undefined): number | undefined => {
  if (raw === undefined || !/^\s*\d+\s*$/.test(raw)) return undefined;

  return Number.parseInt(raw, 10);
};

/**
 * Reads the SSR tuning settings from the environment.
 *
 * Read per request rather than at module load so tests, and a restarted
 * process with new env, always see the current values.
 *
 * @param env - The process environment.
 * @returns The settings. Invalid or missing values fall back to defaults; the
 *   timeout is clamped to 100–5000 ms so a typo can neither disable the
 *   timeout nor make every SSR request time out instantly.
 */
export const readSsrSettings = (env: NodeJS.ProcessEnv): SsrSettings => {
  const timeout = parsePositiveInt(env.APPFLOWY_SSR_SNAPSHOT_TIMEOUT_MS) ?? DEFAULT_SNAPSHOT_TIMEOUT_MS;
  const maxInlineBytes = parsePositiveInt(env.APPFLOWY_SSR_MAX_INLINE_BYTES) ?? DEFAULT_MAX_INLINE_BYTES;

  return {
    snapshotTimeoutMs: Math.min(MAX_SNAPSHOT_TIMEOUT_MS, Math.max(MIN_SNAPSHOT_TIMEOUT_MS, timeout)),
    maxInlineBytes,
  };
};

/**
 * Summarizes the effective SSR configuration for the startup log.
 *
 * A misspelled variable name (e.g. `APPFLOWY_SSR_KILLSWITCH`) is silently
 * ignored by the process, so logging what was actually understood is the only
 * way an operator can confirm a change took effect.
 *
 * @param env - The process environment.
 * @returns A single human-readable line.
 */
export const describeSsrConfig = (env: NodeJS.ProcessEnv): string => {
  const allowlist = Array.from(parseNamespaceAllowlist(env.APPFLOWY_INDEXABLE_NAMESPACES));
  const { snapshotTimeoutMs, maxInlineBytes } = readSsrSettings(env);

  return [
    `SSR kill switch: ${isKillSwitchOn(env) ? 'ON (SSR disabled)' : 'off'}`,
    `indexable namespaces: ${allowlist.length > 0 ? allowlist.join(', ') : '(none)'}`,
    `snapshot timeout: ${snapshotTimeoutMs}ms`,
    `max inline snapshot: ${maxInlineBytes} bytes`,
  ].join('; ');
};
