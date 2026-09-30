// @ts-expect-error no bun
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import { fetch } from 'bun';

import { baseURL } from './config';
import { logger } from './logger';

export const fetchPublishMetadata = async (namespace: string, publishName?: string) => {
  const encodedNamespace = encodeURIComponent(namespace);
  let url = `${baseURL}/api/workspace/published/${encodedNamespace}`;

  if (publishName) {
    url = `${baseURL}/api/workspace/v1/published/${encodedNamespace}/${encodeURIComponent(publishName)}`;
  }

  logger.debug(`Fetching meta data from ${url}`);

  const response = await fetch(url, {
    verbose: false,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const data = await response.json();

  logger.debug(`Fetched meta data from ${url}: ${JSON.stringify(data)}`);

  return data;
};

export type SnapshotFetchResult =
  | { ok: true; snapshot: unknown }
  | { ok: false; reason: 'timeout' | 'http_error' | 'api_error' | 'network_error' | 'invalid_json' };

/**
 * Fetches the published-page snapshot used to server-render the page body.
 *
 * Anonymous, like `fetchPublishMetadata`: this server only ever reads
 * published-namespace endpoints and never forwards the visitor's credentials,
 * so no authenticated content can reach the SSR path.
 *
 * @param namespace - The publish namespace (decoded; re-encoded here).
 * @param publishName - The page's publish name (decoded; re-encoded here).
 * @param timeoutMs - How long to wait before giving up.
 * @returns The untrusted snapshot JSON (`data` of the API response), or a
 *   failure reason. Never throws and never waits longer than `timeoutMs`:
 *   SSR is an enhancement, so any failure here means "serve the shell".
 */
export const fetchPublishSnapshot = async (
  namespace: string,
  publishName: string,
  timeoutMs: number
): Promise<SnapshotFetchResult> => {
  const url = `${baseURL}/api/workspace/v2/published/${encodeURIComponent(namespace)}/${encodeURIComponent(publishName)}/snapshot`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Race against our own timer rather than relying on the abort signal alone,
  // so the deadline holds even if the fetch implementation ignores the signal.
  const timeout = new Promise<SnapshotFetchResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: 'timeout' });
    }, timeoutMs);
  });

  const request = (async (): Promise<SnapshotFetchResult> => {
    let response;

    try {
      response = await fetch(url, { verbose: false, signal: controller.signal });
    } catch {
      return { ok: false, reason: 'network_error' };
    }

    if (!response.ok) return { ok: false, reason: 'http_error' };

    let body;

    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: 'invalid_json' };
    }

    if (!body || body.code !== 0) return { ok: false, reason: 'api_error' };

    return { ok: true, snapshot: body.data };
  })();

  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

export type PublishedViewRoute = { namespace: string; publishName: string };

/**
 * Looks up where a view is published, so a server-rendered page can link to
 * its published sub-pages and page mentions. The client does the same lookup
 * when a reader clicks the link.
 *
 * Anonymous, like the other published endpoints. The response also carries
 * the publisher's email; only `namespace` and `publish_name` are read, and the
 * body is never logged.
 *
 * @param viewId - The view to look up.
 * @param signal - Aborts the request when the caller's deadline passes.
 * @returns The route, or null when the view is not published (the API
 *   answers `code != 0` or a 4xx). Throws on network errors and 5xx, which are
 *   transient and must not be cached as "not published".
 */
export const fetchPublishedViewRoute = async (
  viewId: string,
  signal: AbortSignal
): Promise<PublishedViewRoute | null> => {
  const url = `${baseURL}/api/workspace/v1/published-info/${encodeURIComponent(viewId)}`;
  const response = await fetch(url, { verbose: false, signal });

  if (response.status >= 500) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  if (!response.ok) return null;

  const body = await response.json();
  const data = body?.code === 0 ? body.data : undefined;

  if (
    !data ||
    typeof data.namespace !== 'string' ||
    data.namespace.length === 0 ||
    typeof data.publish_name !== 'string' ||
    data.publish_name.length === 0 ||
    // Defensive: never link to a page the API reports as unpublished.
    (data.unpublished_timestamp !== null && data.unpublished_timestamp !== undefined)
  ) {
    return null;
  }

  return { namespace: data.namespace, publishName: data.publish_name };
};
