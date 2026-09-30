import { normalizePublishedPageSnapshot } from './normalize';
import type { PublishedPageSnapshot, PublishedPageSnapshotPayload } from './types';

/**
 * Id of the `<script type="application/json">` block the server emits after
 * #root when it server-renders a published page (see deploy/html.ts), so the
 * client does not fetch the snapshot a second time. Absent in local dev, on
 * the static deployment, for non-SSR pages, and for snapshots too large to
 * inline.
 */
export const INLINED_PUBLISH_SNAPSHOT_ID = 'appflowy-publish-snapshot';

type InlinedEntry = { namespace: string; publishName: string; snapshot: PublishedPageSnapshot };

// undefined: the block has not been read yet. null: nothing usable.
let entry: InlinedEntry | null | undefined;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readEntry = (): InlinedEntry | null => {
  const text = document.getElementById(INLINED_PUBLISH_SNAPSHOT_ID)?.textContent;

  if (!text) return null;

  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  if (
    !isObject(raw) ||
    raw.schemaVersion !== 1 ||
    (raw.kind !== 'document' && raw.kind !== 'database') ||
    !isObject(raw.view) ||
    typeof raw.namespace !== 'string' ||
    typeof raw.publishName !== 'string'
  ) {
    return null;
  }

  try {
    return {
      namespace: raw.namespace,
      publishName: raw.publishName,
      snapshot: normalizePublishedPageSnapshot(raw as unknown as PublishedPageSnapshotPayload),
    };
  } catch {
    return null;
  }
};

/**
 * Returns the server-inlined snapshot for a published page, if there is a usable one.
 *
 * Side-effect free apart from caching the parse, so it is safe to call during
 * render: a render React throws away (a suspended first mount, StrictMode's
 * double invocation) can call it again and get the same result. Call
 * `releaseInlinedPublishSnapshot` once the page has committed.
 *
 * @param namespace - Namespace of the page being rendered.
 * @param publishName - Publish name of the page being rendered.
 * @returns The normalized snapshot, or undefined when the block is absent,
 *   released, malformed, for a different page, or fails to normalize. Callers
 *   fall back to fetching, exactly as they did before SSR existed.
 */
export function peekInlinedPublishSnapshot(
  namespace: string,
  publishName: string
): PublishedPageSnapshot | undefined {
  if (typeof document === 'undefined') return undefined;

  entry ??= readEntry();

  if (!entry || entry.namespace !== namespace || entry.publishName !== publishName) return undefined;

  return entry.snapshot;
}

/**
 * Drops the inlined snapshot so it is used at most once: after an in-app
 * navigation a page must be fetched normally, never served from a snapshot
 * that belonged to the first page loaded. Also frees the parsed copy and the
 * (possibly large) JSON text in the DOM.
 */
export function releaseInlinedPublishSnapshot() {
  if (typeof document === 'undefined') return;

  document.getElementById(INLINED_PUBLISH_SNAPSHOT_ID)?.remove();
  // Back to "not read": the block is gone, so a later peek finds nothing.
  entry = undefined;
}
