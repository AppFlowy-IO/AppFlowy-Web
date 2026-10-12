import axios, { InternalAxiosRequestConfig } from 'axios';

import { getServerInfoSnapshot } from '@/utils/server-info';

const USER_ERROR_SCHEMA_HEADER = 'X-AppFlowy-Error-Schema';
const USER_ERROR_MEDIA_RANGE = 'application/json; appflowy-error-schema=1';

/** Preserve other media ranges, including commas inside quoted parameters. */
function withoutErrorSchemaOffer(accept: string): string {
  const ranges: string[] = [];
  let quoted = false;
  let escaped = false;
  let start = 0;

  for (let index = 0; index < accept.length; index += 1) {
    const char = accept[index];

    if (escaped) escaped = false;
    else if (quoted && char === '\\') escaped = true;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') {
      ranges.push(accept.slice(start, index));
      start = index + 1;
    }
  }

  ranges.push(accept.slice(start));
  return ranges.filter((range) => range.trim() !== USER_ERROR_MEDIA_RANGE).join(',');
}

/**
 * Older Cloud proxies reject new custom headers even after a server upgrade.
 * Negotiate through Accept only after server-info advertises support, and only
 * with that configured Cloud API. This keeps existing proxy CORS policies usable.
 */
export function applyErrorCapability(
  request: InternalAxiosRequestConfig,
  configuredBaseURL: string,
  effectiveBaseURL: string
): void {
  request.headers.delete?.(USER_ERROR_SCHEMA_HEADER);
  const originalAccept = request.headers.get?.('Accept');
  const accept = typeof originalAccept === 'string' ? withoutErrorSchemaOffer(originalAccept) : '';
  const serverInfo = getServerInfoSnapshot(configuredBaseURL);
  let supported = false;

  if (serverInfo.status === 'available' && serverInfo.info.supported_error_schema_version === 1) {
    try {
      const origin = typeof window === 'undefined' ? undefined : window.location.origin;
      const cloud = new URL(effectiveBaseURL, origin);
      const target = new URL(axios.getUri(request), origin);
      const apiPath = `${cloud.pathname.replace(/\/+$/, '')}/api/`;
      const discoveryPath = `${apiPath}server-info`;

      supported = target.origin === cloud.origin && target.pathname.startsWith(apiPath) &&
        // Keep discovery usable after a server rollback, even with cached info.
        target.pathname !== discoveryPath && !target.pathname.startsWith(`${discoveryPath}/`);
    } catch {
      // An unresolvable URL cannot establish server capability; retain legacy behavior.
    }
  }

  const negotiatedAccept = `${accept}${accept ? ', ' : ''}${USER_ERROR_MEDIA_RANGE}`;

  // Keep an otherwise safelisted Accept within the browser's 128-byte limit.
  // Respect callers that explicitly disable this header.
  if (supported && (originalAccept === undefined || typeof originalAccept === 'string') &&
    new TextEncoder().encode(negotiatedAccept).length <= 128) {
    request.headers.set('Accept', negotiatedAccept);
  } else if (typeof originalAccept === 'string' && accept !== originalAccept) {
    if (accept) request.headers.set('Accept', accept);
    else request.headers.delete?.('Accept');
  }
}
