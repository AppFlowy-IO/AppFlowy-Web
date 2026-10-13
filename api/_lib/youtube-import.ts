import { combineAbortSignals, YoutubeAudioRepository, YoutubeImportError } from './youtube';

interface YoutubeImportOptions {
  baseURL: string;
  fetcher?: typeof fetch;
}

function json(status: number, code: number, message: string, data?: unknown) {
  return new Response(JSON.stringify({ code, message, data }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}

/** The bearer token goes only to the configured AppFlowy server, never to YouTube. */
export async function handleYoutubeImport(request: Request, { baseURL, fetcher = fetch }: YoutubeImportOptions) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') ?? 'metadata';

  if ((action !== 'metadata' && action !== 'audio') || request.method !== (action === 'audio' ? 'POST' : 'GET'))
    return json(405, 405, 'Method not allowed');
  if (request.headers.get('sec-fetch-site') === 'cross-site') return json(403, 403, 'Forbidden');
  const authorization = request.headers.get('authorization');
  const workspaceId = url.searchParams.get('workspace_id');

  if (!authorization?.startsWith('Bearer ')) return json(401, 401, 'Unauthorized');
  if (!workspaceId || !/^[\w-]{1,80}$/.test(workspaceId)) return json(400, 400, 'Invalid workspace');

  try {
    const repository = new YoutubeAudioRepository(url.searchParams.get('url') ?? '', fetcher);
    const usageResponse = await fetcher(
      `${baseURL.replace(/\/$/, '')}/api/workspace/${encodeURIComponent(workspaceId)}/usage-and-limit`,
      { headers: { Authorization: authorization }, signal: combineAbortSignals([request.signal, AbortSignal.timeout(15_000)]), redirect: 'error' }
    );
    const allowance = await usageResponse.json().catch(() => undefined);

    if (!usageResponse.ok || allowance?.code !== 0 || !allowance.data)
      return json(usageResponse.ok ? 502 : usageResponse.status, allowance?.code || usageResponse.status, 'usageFailed');
    const usage = allowance.data;
    const used = usage.ai_transcription_seconds;
    const limit = usage.ai_transcription_seconds_limit;
    const limited = Number.isFinite(used) && used >= 0 && Number.isFinite(limit) && limit >= 0;

    if (!limited) return json(502, 502, 'usageFailed');
    if (used >= limit) return json(403, 1129, 'quotaExceeded');
    const metadata = await repository.metadata(request.signal);

    if (action === 'metadata') return json(200, 0, '', metadata);
    if (metadata.duration !== undefined && metadata.duration > limit - used)
      return json(400, 400, 'recordingTooLong');
    const hardLimit = 512 * 1024 * 1024;
    const maxBytes = !usage.single_upload_unlimited && Number.isFinite(usage.single_upload_limit) && usage.single_upload_limit > 0
      ? Math.min(hardLimit, usage.single_upload_limit) : hardLimit;
    const audio = await repository.audio(request.signal, maxBytes);

    return new Response(audio.stream, {
      headers: {
        'Content-Type': 'audio/mp4',
        'Content-Length': String(audio.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof YoutubeImportError) {
      const status = error.code === 'youtubeDownloadBlocked' ? 502 : 400;

      return json(status, status, error.code, error.maxBytes ? { max_bytes: error.maxBytes } : undefined);
    }

    return json(502, 502, action === 'audio' ? 'youtubeDownloadFailed' : 'youtubeMetadataFailed');
  }
}
