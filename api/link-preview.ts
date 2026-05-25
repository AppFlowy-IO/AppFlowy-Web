import type { IncomingMessage, ServerResponse } from 'http';

import { isAllowedHttpUrl } from './_lib/url-safety';
import { unfurl } from './_lib/unfurl';

// Cache successful previews at the edge so repeat loads are cheap, mirroring the
// desktop LinkInfoCache.
const CACHE_CONTROL = 'public, s-maxage=600, stale-while-revalidate=86400';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const target = readUrlParam(req);
  if (!target) return sendJson(res, 400, { error: 'Missing "url" query parameter' });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return sendJson(res, 400, { error: 'Invalid URL' });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return sendJson(res, 400, { error: 'Unsupported protocol' });
  }

  if (!isAllowedHttpUrl(parsed)) {
    return sendJson(res, 400, { error: 'Blocked host' });
  }

  try {
    const data = await unfurl(parsed.toString());
    res.setHeader('Cache-Control', CACHE_CONTROL);
    return sendJson(res, 200, data);
  } catch {
    return sendJson(res, 502, { error: 'Failed to fetch link preview' });
  }
}

function readUrlParam(req: IncomingMessage): string | null {
  try {
    return new URL(req.url ?? '', 'http://localhost').searchParams.get('url');
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
