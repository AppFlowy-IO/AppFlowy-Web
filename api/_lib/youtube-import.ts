import { combineAbortSignals, YoutubeCaptionRepository, YoutubeImportError } from './youtube';

interface YoutubeImportOptions {
  baseURL: string;
  fetcher?: typeof fetch;
}

function json(status: number, code: number, message: string, requestId: string, data?: unknown) {
  return new Response(JSON.stringify({ code, message, data }), {
    status,
    headers: {
      'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': requestId,
    },
  });
}

/** Short id echoed as X-Request-Id so the dialog's Details line can be matched with server logs. */
function newRequestId() {
  return (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)).replace(/-/g, '').slice(0, 12);
}

/** Authenticate workspace access with AppFlowy; YouTube receives no user credentials or media requests. */
export async function handleYoutubeImport(request: Request, { baseURL, fetcher = fetch }: YoutubeImportOptions) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') ?? 'metadata';
  const requestId = newRequestId();
  const reply = (status: number, code: number, message: string, data?: unknown) => json(status, code, message, requestId, data);

  if (!['metadata', 'captions'].includes(action) || request.method !== 'GET') return reply(405, 405, 'Method not allowed');
  if (request.headers.get('sec-fetch-site') === 'cross-site') return reply(403, 403, 'Forbidden');
  const authorization = request.headers.get('authorization');
  const workspaceId = url.searchParams.get('workspace_id');
  const language = url.searchParams.get('language') || undefined;

  if (!authorization?.startsWith('Bearer ')) return reply(401, 401, 'Unauthorized');
  if (!workspaceId || !/^[\w-]{1,80}$/.test(workspaceId)) return reply(400, 400, 'Invalid workspace');
  if (language && !/^[\w-]{1,35}$/.test(language)) return reply(400, 400, 'Invalid language');

  try {
    const repository = new YoutubeCaptionRepository(url.searchParams.get('url') ?? '', fetcher);
    let usageResponse: Response;

    try {
      usageResponse = await fetcher(
        `${baseURL.replace(/\/$/, '')}/api/workspace/${encodeURIComponent(workspaceId)}/usage-and-limit`,
        { headers: { Authorization: authorization }, signal: combineAbortSignals([request.signal, AbortSignal.timeout(15_000)]), redirect: 'error' }
      );
    } catch (error) {
      // The usage service is down or unreachable: that is AppFlowy's outage, not a problem with the link.
      if (request.signal.aborted) throw error;
      return reply(503, 503, 'usageUnavailable');
    }

    const allowance = await usageResponse.json().catch(() => undefined);

    if (usageResponse.status >= 500) return reply(503, 503, 'usageUnavailable');
    if (!usageResponse.ok || allowance?.code !== 0 || !allowance.data)
      return reply(usageResponse.ok ? 502 : usageResponse.status, allowance?.code || usageResponse.status, 'usageFailed');
    // Importing existing text consumes neither transcription minutes nor file storage.
    return reply(200, 0, '', action === 'metadata' ? await repository.metadata(request.signal) :
      await repository.captions(request.signal, language));
  } catch (error) {
    if (error instanceof YoutubeImportError) {
      const status = error.code === 'youtubeVideoUnavailable' ? 404 :
        ['youtubeBlocked', 'youtubeCaptionsBlocked', 'youtubeCaptionsFailed', 'youtubeMetadataFailed'].includes(error.code) ? 502 : 400;

      return reply(status, status, error.code);
    }

    return reply(502, 502, action === 'captions' ? 'youtubeCaptionsFailed' : 'youtubeMetadataFailed');
  }
}
