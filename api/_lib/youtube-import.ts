import { combineAbortSignals, YoutubeCaptionRepository, YoutubeImportError } from './youtube';

interface YoutubeImportOptions {
  baseURL: string;
  fetcher?: typeof fetch;
}

function json(status: number, code: number, message: string, data?: unknown) {
  return new Response(JSON.stringify({ code, message, data }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** Authenticate workspace access with AppFlowy; YouTube receives no user credentials or media requests. */
export async function handleYoutubeImport(request: Request, { baseURL, fetcher = fetch }: YoutubeImportOptions) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') ?? 'metadata';

  if (!['metadata', 'captions'].includes(action) || request.method !== 'GET') return json(405, 405, 'Method not allowed');
  if (request.headers.get('sec-fetch-site') === 'cross-site') return json(403, 403, 'Forbidden');
  const authorization = request.headers.get('authorization');
  const workspaceId = url.searchParams.get('workspace_id');
  const language = url.searchParams.get('language') || undefined;

  if (!authorization?.startsWith('Bearer ')) return json(401, 401, 'Unauthorized');
  if (!workspaceId || !/^[\w-]{1,80}$/.test(workspaceId)) return json(400, 400, 'Invalid workspace');
  if (language && !/^[\w-]{1,35}$/.test(language)) return json(400, 400, 'Invalid language');

  try {
    const repository = new YoutubeCaptionRepository(url.searchParams.get('url') ?? '', fetcher);
    const usageResponse = await fetcher(
      `${baseURL.replace(/\/$/, '')}/api/workspace/${encodeURIComponent(workspaceId)}/usage-and-limit`,
      { headers: { Authorization: authorization }, signal: combineAbortSignals([request.signal, AbortSignal.timeout(15_000)]), redirect: 'error' }
    );
    const allowance = await usageResponse.json().catch(() => undefined);

    if (!usageResponse.ok || allowance?.code !== 0 || !allowance.data)
      return json(usageResponse.ok ? 502 : usageResponse.status, allowance?.code || usageResponse.status, 'usageFailed');
    // Importing existing text consumes neither transcription minutes nor file storage.
    return json(200, 0, '', action === 'metadata' ? await repository.metadata(request.signal) :
      await repository.captions(request.signal, language));
  } catch (error) {
    if (error instanceof YoutubeImportError) {
      const status = ['youtubeCaptionsBlocked', 'youtubeCaptionsFailed', 'youtubeMetadataFailed'].includes(error.code) ? 502 : 400;

      return json(status, status, error.code);
    }

    return json(502, 502, action === 'captions' ? 'youtubeCaptionsFailed' : 'youtubeMetadataFailed');
  }
}
