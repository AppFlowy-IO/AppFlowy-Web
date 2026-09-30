import { normalizePublishedPageSnapshot } from './normalize';
import type { PublishedPageSnapshot, PublishedPageSnapshotPayload } from './types';

declare global {
  interface Window {
    /**
     * Snapshot inlined by the server when it server-renders a published page
     * (see deploy/html.ts), so the client does not fetch it a second time.
     * Absent in local dev, on the static deployment, and for non-SSR pages.
     */
    __APPFLOWY_PUBLISH_SNAPSHOT__?: unknown;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Takes the server-inlined snapshot for a published page, if there is a usable one.
 *
 * The global is removed on first read so it is used at most once: after an
 * in-app navigation the page must be fetched normally, never served from a
 * snapshot that belonged to the first page loaded.
 *
 * @param namespace - Namespace of the page being rendered.
 * @param publishName - Publish name of the page being rendered.
 * @returns The normalized snapshot, or undefined when the global is absent,
 *   malformed, for a different page, or fails to normalize. Callers fall back
 *   to fetching, exactly as they did before SSR existed.
 */
export function takeInlinedPublishSnapshot(
  namespace: string,
  publishName: string
): PublishedPageSnapshot | undefined {
  if (typeof window === 'undefined') return undefined;

  const raw = window.__APPFLOWY_PUBLISH_SNAPSHOT__;

  if (raw === undefined) return undefined;

  delete window.__APPFLOWY_PUBLISH_SNAPSHOT__;

  if (
    !isObject(raw) ||
    raw.schemaVersion !== 1 ||
    (raw.kind !== 'document' && raw.kind !== 'database') ||
    !isObject(raw.view) ||
    raw.namespace !== namespace ||
    raw.publishName !== publishName
  ) {
    return undefined;
  }

  try {
    return normalizePublishedPageSnapshot(raw as unknown as PublishedPageSnapshotPayload);
  } catch {
    return undefined;
  }
}
