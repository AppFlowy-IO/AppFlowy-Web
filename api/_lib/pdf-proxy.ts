import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

import ipaddr from 'ipaddr.js';

import type { IncomingMessage } from 'node:http';

export const MAX_PDF_BYTES = 512 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

export function parsePublicPDFUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (
    !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
    hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.internal') ||
    (isIP(hostname) && !isPublicAddress(hostname))
  ) throw new Error('Blocked PDF URL');
  return url;
}

export function parsePDFRange(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=(\d+)-(\d+)$/.exec(value);
  const start = Number(match?.[1]);
  const end = Number(match?.[2]);

  if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= MAX_PDF_BYTES)
    throw new Error('Invalid PDF range');
  return `bytes=${start}-${end}`;
}

async function requestPublicPDF(url: URL, range: string | undefined, signal: AbortSignal): Promise<IncomingMessage> {
  signal.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
      const abort = () => reject(signal.reason);

      signal.addEventListener('abort', abort, { once: true });
      void lookup(hostname, { all: true, verbatim: true }).then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    });

  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new Error('Blocked PDF address');
  signal.throwIfAborted();
  const address = addresses[0];

  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(url, {
      signal,
      // Connect to the checked IP directly; retain the original host for TLS
      // verification and virtual hosting. This also avoids a second DNS lookup
      // in runtimes that do not support Node's custom lookup callback.
      hostname: address.address,
      servername: isIP(hostname) ? undefined : hostname,
      family: address.family,
      headers: {
        Host: url.host,
        Accept: 'application/pdf,application/octet-stream;q=0.9',
        'Accept-Encoding': 'identity',
        ...(range ? { Range: range } : {}),
      },
      agent: false,
    }, resolve);

    req.on('error', reject);
    req.end();
  });
}

export async function fetchPublicPDF(rawUrl: string, range: string | undefined, signal: AbortSignal): Promise<IncomingMessage> {
  let url = parsePublicPDFUrl(rawUrl);

  for (let redirect = 0; redirect <= 5; redirect++) {
    const response = await requestPublicPDF(url, range, signal);

    if (!REDIRECT_STATUSES.has(response.statusCode ?? 0)) return response;
    const location = response.headers.location;

    response.destroy();
    if (!location) throw new Error('Missing PDF redirect');
    // Validate every hop, including its resolved address in requestPublicPDF.
    url = parsePublicPDFUrl(new URL(location, url).href);
  }

  throw new Error('Too many PDF redirects');
}

/** Check PDF bytes before serving them from the application origin. */
export async function* pdfChunks(response: IncomingMessage, range?: string): AsyncGenerator<Buffer> {
  const contentType = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
  const length = Number(response.headers['content-length']);

  if (response.statusCode !== 200 && response.statusCode !== 206) throw new Error('PDF fetch failed');
  if (contentType && !['application/pdf', 'application/octet-stream', 'binary/octet-stream'].includes(contentType))
    throw new Error('Not a PDF');
  const encoding = response.headers['content-encoding'];

  if (length > MAX_PDF_BYTES || (encoding && encoding !== 'identity')) throw new Error('Unsupported PDF response');
  if (response.statusCode === 206) {
    const returned = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] ?? '');
    const requested = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');

    if (!returned || !requested || returned[1] !== requested[1] || Number(returned[2]) > Number(requested[2]) ||
      Number(returned[3]) > MAX_PDF_BYTES || Number(returned[2]) < Number(returned[1]))
      throw new Error('Invalid PDF range response');
  }

  const needsSignature = response.statusCode === 200 || range?.startsWith('bytes=0-');
  let prefix = Buffer.alloc(0);
  let verified = !needsSignature;
  let total = 0;

  for await (const value of response) {
    const chunk = Buffer.from(value);

    total += chunk.length;
    if (total > MAX_PDF_BYTES) throw new Error('PDF too large');
    if (!verified) {
      prefix = Buffer.concat([prefix, chunk]);
      if (prefix.length < 5) continue;
      if (!prefix.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Not a PDF');
      verified = true;
      yield prefix;
      prefix = Buffer.alloc(0);
    } else yield chunk;
  }

  if (!verified) throw new Error('Empty PDF');
}
