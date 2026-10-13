/** @jest-environment node */
import { handleYoutubeImport } from '../youtube-import';

const videoId = 'lr3hNhA0IfQ';
const cloud = 'https://cloud.example.com';
const chunkSize = 1024 * 1024;

interface AudioTrackFixture {
  id: string;
  displayName: string;
  audioIsDefault: boolean;
  isAutoDubbed?: boolean;
  bitrate: number;
}

function request(action = 'metadata', authenticated = true, extraHeaders?: Record<string, string>) {
  const url = new URL('http://localhost:3002/api/youtube-audio');

  url.searchParams.set('url', `https://youtu.be/${videoId}?si=share`);
  url.searchParams.set('workspace_id', 'workspace');
  url.searchParams.set('action', action);
  return new Request(url, { method: action === 'audio' ? 'POST' : 'GET', headers: {
    ...(authenticated ? { authorization: 'Bearer appflowy-session' } : {}), ...extraHeaders,
  } });
}

function fakeUpstreams(options: {
  used?: number; limit?: number; duration?: string; size?: number; uploadLimit?: number;
  vrUnavailable?: boolean; androidUnavailable?: boolean; fallbackUnavailable?: boolean; fallbackSize?: number;
  forbidden?: number; forbiddenClients?: string[]; invalidStream?: boolean; missingBytes?: boolean; unavailable?: boolean;
  tracks?: (client: string) => AudioTrackFixture[];
} = {}) {
  const size = options.size ?? chunkSize + 17;
  let failures = options.forbidden ?? 0;

  return jest.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    init?.signal?.throwIfAborted();
    const url = new URL(String(input));

    if (url.origin === cloud) return Response.json({ code: 0, data: {
      ai_transcription_seconds: options.used ?? 0, ai_transcription_seconds_limit: options.limit ?? 1800,
      single_upload_limit: options.uploadLimit ?? 25 * 1024 * 1024,
    } });
    if (url.pathname === '/watch') return new Response(`<script>var ytInitialPlayerResponse = ${JSON.stringify({
      playabilityStatus: { status: options.unavailable ? 'ERROR' : 'OK' },
      videoDetails: { videoId, title: 'Team {meeting} "recording"', author: 'AppFlowy', lengthSeconds: options.duration ?? '120', thumbnail: { thumbnails: [{ width: 640, url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }] } },
    })};</script><script>ytcfg.set({"STS":20000,"VISITOR_DATA":"visitor"});</script>`, { headers: { 'Set-Cookie': 'YSC=youtube-session; Path=/; Secure' } });
    if (url.pathname.includes('/player')) {
      const { context } = JSON.parse(String(init?.body));
      const client = context.client.clientName;

      const unavailable = (options.vrUnavailable && client === 'ANDROID_VR') || (options.androidUnavailable && client === 'ANDROID') || (options.fallbackUnavailable && client === 'VISIONOS');

      const format = {
        itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: client === 'ANDROID_VR' ? 128000 : 256000,
        contentLength: String(client === 'VISIONOS' ? options.fallbackSize ?? size : size),
        url: options.invalidStream ? 'http://127.0.0.1/private' : `https://rr1.googlevideo.com/videoplayback?c=${client}`,
      };
      const formats = options.tracks?.(client).map(({ bitrate, ...audioTrack }) => ({
        ...format, bitrate, audioTrack, url: `${format.url}&track=${encodeURIComponent(audioTrack.id)}`,
      })) ?? [format];

      return Response.json({ playabilityStatus: { status: unavailable ? 'LOGIN_REQUIRED' : 'OK' }, streamingData: { adaptiveFormats: formats } });
    }

    if (url.hostname.endsWith('.googlevideo.com')) {
      if (init?.method === 'HEAD') return new Response(null);
      const range = new Headers(init?.headers).get('range') ?? `bytes=${url.searchParams.get('range')}`;
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)!;

      if ((Number(match[1]) > 0 || options.forbidden === Infinity) && (failures > 0 || options.forbiddenClients?.includes(url.searchParams.get('c')!))) {
        failures--;
        return new Response(null, { status: 403 });
      }

      return new Response(new Uint8Array(Number(match[2]) - Number(match[1]) + (options.missingBytes ? 0 : 1)).fill(url.searchParams.get('c') === 'VISIONOS' ? 9 : 7), { status: 206 });
    }

    throw new Error(`Unexpected upstream ${url.origin}${url.pathname}`);
  });
}

function bridge(fetcher: ReturnType<typeof fakeUpstreams>, action = 'metadata') {
  return handleYoutubeImport(request(action), { baseURL: cloud, fetcher: fetcher as unknown as typeof fetch });
}

function downloadedAudioUrls(fetcher: ReturnType<typeof fakeUpstreams>) {
  return fetcher.mock.calls
    .filter(([input, init]) => String(input).includes('.googlevideo.com') && init?.method !== 'HEAD')
    .map(([input]) => new URL(String(input)));
}

describe('authenticated Flutter YouTube server bridge', () => {
  it('rejects an unauthenticated or cross-site request before fetching any resource', async () => {
    const fetcher = fakeUpstreams();

    expect((await handleYoutubeImport(request('metadata', false), { baseURL: cloud, fetcher: fetcher as unknown as typeof fetch })).status).toBe(401);
    expect((await handleYoutubeImport(request('metadata', true, { 'sec-fetch-site': 'cross-site' }), { baseURL: cloud, fetcher: fetcher as unknown as typeof fetch })).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses watch-page metadata and keeps the AppFlowy token away from YouTube', async () => {
    const fetcher = fakeUpstreams();
    const response = await bridge(fetcher);

    expect(await response.json()).toMatchObject({ code: 0, data: { videoId, title: 'Team {meeting} "recording"', duration: 120, author: 'AppFlowy' } });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const [, cloudOptions] = fetcher.mock.calls[0];
    const [, youtubeOptions] = fetcher.mock.calls[1];

    expect(new Headers(cloudOptions?.headers).get('authorization')).toBe('Bearer appflowy-session');
    expect(new Headers(youtubeOptions?.headers).has('authorization')).toBe(false);
    expect(new Headers(youtubeOptions?.headers).get('cookie')).toContain('SOCS=CAI');
    expect(youtubeOptions?.redirect).toBe('error');
  });

  it('blocks exhausted usage before making a YouTube request', async () => {
    const fetcher = fakeUpstreams({ used: 1800 });
    const response = await bridge(fetcher, 'audio');

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 1129, message: 'quotaExceeded' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not contact YouTube if workspace usage cannot be checked', async () => {
    const fetcher = fakeUpstreams();

    fetcher.mockResolvedValueOnce(Response.json({ code: 0, data: {} }));
    expect(await (await bridge(fetcher)).json()).toMatchObject({ message: 'usageFailed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries a transient player failure, then downloads without changing clients', async () => {
    const fetcher = fakeUpstreams();
    const upstream = fetcher.getMockImplementation()!;
    let failed = false;

    fetcher.mockImplementation(async (input, init) => {
      if (String(input).includes('/player') && !failed) {
        failed = true;
        return new Response(null, { status: 503 });
      }

      return upstream(input, init);
    });
    const response = await bridge(fetcher, 'audio');

    expect((await response.arrayBuffer()).byteLength).toBe(chunkSize + 17);
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('/player'))).toHaveLength(3);
  });

  it('checks the whole video against remaining seconds before downloading', async () => {
    const fetcher = fakeUpstreams({ used: 1741 });
    const response = await bridge(fetcher, 'audio');

    expect(await response.json()).toMatchObject({ code: 400, message: 'recordingTooLong' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(['45', '14401', '0'])('blocks invalid video duration %s', async (duration) => {
    const fetcher = fakeUpstreams({ duration, limit: 20000 });
    const response = await bridge(fetcher, 'audio');

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe(duration === '0' ? 'youtubeDurationUnavailable' : 'youtubeDurationOutOfRange');
  });

  it('streams complete 1 MB ranges and prefers native Android VR over a higher bitrate Android stream', async () => {
    const fetcher = fakeUpstreams();
    const response = await bridge(fetcher, 'audio');
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.headers.get('content-type')).toBe('audio/mp4');
    expect(Number(response.headers.get('content-length'))).toBe(chunkSize + 17);
    expect(bytes.length).toBe(chunkSize + 17);
    expect(bytes.every((byte) => byte === 7)).toBe(true);
    const chunks = fetcher.mock.calls.filter(([input, init]) => String(input).includes('.googlevideo.com') && init?.method !== 'HEAD');

    expect(chunks).toHaveLength(2);
    expect(new Headers(chunks[0][1]?.headers).get('range')).toBe(`bytes=0-${chunkSize - 1}`);
    expect(new Headers(chunks[1][1]?.headers).get('range')).toBe(`bytes=${chunkSize}-${chunkSize + 16}`);
    expect(chunks.every(([input]) => String(input).includes('c=ANDROID_VR'))).toBe(true);
    expect(chunks.every(([, init]) => !new Headers(init?.headers).has('authorization'))).toBe(true);
  });

  it('falls back to the native Android client if Android VR is unavailable', async () => {
    const fetcher = fakeUpstreams({ vrUnavailable: true, size: 17 });
    const response = await bridge(fetcher, 'audio');

    expect((await response.arrayBuffer()).byteLength).toBe(17);
    const chunk = fetcher.mock.calls.find(([input, init]) => String(input).includes('.googlevideo.com') && init?.method !== 'HEAD')!;

    expect(String(chunk[0])).toContain('c=ANDROID');
  });

  it.each(['en-US', 'es'])('imports the original %s audio instead of a higher-bitrate auto-dub', async (language) => {
    const trackId = `${language}.4`;
    const fetcher = fakeUpstreams({ size: 17, tracks: () => [
      { id: 'pl.10', displayName: 'Polish', audioIsDefault: false, isAutoDubbed: true, bitrate: 131180 },
      { id: trackId, displayName: `${language} original`, audioIsDefault: true, bitrate: 131176 },
    ] });
    const response = await bridge(fetcher, 'audio');

    expect((await response.arrayBuffer()).byteLength).toBe(17);
    expect(downloadedAudioUrls(fetcher).map((url) => url.searchParams.get('track'))).toEqual([trackId]);
  });

  it('keeps the original language when falling back to VisionOS', async () => {
    const fetcher = fakeUpstreams({ size: 17, vrUnavailable: true, androidUnavailable: true, tracks: () => [
      { id: 'pl.10', displayName: 'Polish', audioIsDefault: false, isAutoDubbed: true, bitrate: 131180 },
      { id: 'en-US.4', displayName: 'English (US) original', audioIsDefault: true, bitrate: 131176 },
    ] });
    const response = await bridge(fetcher, 'audio');

    expect((await response.arrayBuffer()).byteLength).toBe(17);
    expect(downloadedAudioUrls(fetcher).map((url) => [url.searchParams.get('c'), url.searchParams.get('track')]))
      .toEqual([['VISIONOS', 'en-US.4']]);
  });

  it('prefers the original track over another client\'s localized default', async () => {
    const fetcher = fakeUpstreams({ size: 17, tracks: (client) => client === 'ANDROID_VR' ? [
      { id: 'fr.1', displayName: 'French', audioIsDefault: true, bitrate: 256000 },
    ] : [
      { id: 'en-US.4', displayName: 'English (US) original', audioIsDefault: false, bitrate: 128000 },
    ] });
    const response = await bridge(fetcher, 'audio');

    expect((await response.arrayBuffer()).byteLength).toBe(17);
    expect(downloadedAudioUrls(fetcher).map((url) => url.searchParams.get('track'))).toEqual(['en-US.4']);
  });

  it('uses the default source track when the original label is absent', async () => {
    const fetcher = fakeUpstreams({ size: 17, tracks: () => [
      { id: 'fr.1', displayName: 'French', audioIsDefault: false, bitrate: 256000 },
      { id: 'en-US.4', displayName: 'English (US)', audioIsDefault: true, bitrate: 128000 },
    ] });
    const response = await bridge(fetcher, 'audio');

    expect((await response.arrayBuffer()).byteLength).toBe(17);
    expect(downloadedAudioUrls(fetcher).map((url) => url.searchParams.get('track'))).toEqual(['en-US.4']);
  });

  it('tries the fallback client when native clients expose only a default auto-dub', async () => {
    const fetcher = fakeUpstreams({ size: 17, tracks: (client) => client === 'VISIONOS' ? [
      { id: 'en-US.4', displayName: 'English (US) original', audioIsDefault: true, bitrate: 128000 },
    ] : [
      { id: 'pl.10', displayName: 'Polish', audioIsDefault: true, isAutoDubbed: true, bitrate: 256000 },
    ] });
    const response = await bridge(fetcher, 'audio');

    expect((await response.arrayBuffer()).byteLength).toBe(17);
    expect(downloadedAudioUrls(fetcher).map((url) => [url.searchParams.get('c'), url.searchParams.get('track')]))
      .toEqual([['VISIONOS', 'en-US.4']]);
  });

  it('reports a download error when only auto-dubbed tracks are available', async () => {
    const fetcher = fakeUpstreams({ size: 17, tracks: () => [
      { id: 'pl.10', displayName: 'Polish', audioIsDefault: true, isAutoDubbed: true, bitrate: 256000 },
    ] });
    const response = await bridge(fetcher, 'audio');

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: 'youtubeDownloadFailed' });
    expect(downloadedAudioUrls(fetcher)).toEqual([]);
  });

  it('fails before sending partial audio if refreshing loses the selected source track', async () => {
    let refreshed = false;
    const fetcher = fakeUpstreams({ forbidden: 1, tracks: () => [
      { id: refreshed ? 'fr.4' : 'en-US.4', displayName: refreshed ? 'French original' : 'English original', audioIsDefault: true, bitrate: 128000 },
    ] });
    const upstream = fetcher.getMockImplementation()!;

    fetcher.mockImplementation(async (input, init) => {
      const response = await upstream(input, init);

      if (response.status === 403 && String(input).includes('.googlevideo.com')) refreshed = true;
      return response;
    });
    const response = await bridge(fetcher, 'audio');

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ message: 'youtubeDownloadBlocked' });
    expect(new Set(downloadedAudioUrls(fetcher).map((url) => url.searchParams.get('track')))).toEqual(new Set(['en-US.4']));
  });

  it('refreshes a forbidden stream URL without duplicating bytes', async () => {
    const fetcher = fakeUpstreams({ forbidden: 1 });
    const response = await bridge(fetcher, 'audio');

    expect((await response.arrayBuffer()).byteLength).toBe(chunkSize + 17);
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('/player'))).toHaveLength(4);
  });

  it('bounds stream refreshes and client fallback when all streams are forbidden', async () => {
    const fetcher = fakeUpstreams({ forbidden: Infinity });
    const response = await bridge(fetcher, 'audio');

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ message: 'youtubeDownloadBlocked' });
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('/player'))).toHaveLength(16);
  });

  it('restarts with the fallback client before sending any partial native audio to the browser', async () => {
    const fallbackSize = chunkSize * 2 + 31;
    const fetcher = fakeUpstreams({ vrUnavailable: true, forbiddenClients: ['ANDROID'], fallbackSize });
    const response = await bridge(fetcher, 'audio');
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(Number(response.headers.get('content-length'))).toBe(fallbackSize);
    expect(bytes.length).toBe(fallbackSize);
    expect(bytes.every((byte) => byte === 9)).toBe(true);
    const chunks = fetcher.mock.calls.filter(([input, init]) => String(input).includes('.googlevideo.com') && init?.method !== 'HEAD');
    const fallback = chunks.filter(([input]) => new URL(String(input)).searchParams.get('c') === 'VISIONOS');

    expect(chunks.some(([input]) => String(input).includes('c=ANDROID'))).toBe(true);
    expect(fallback).toHaveLength(3);
    expect(new URL(String(fallback[0][0])).searchParams.get('range')).toBe(`0-${chunkSize - 1}`);
    expect(new URL(String(fallback[1][0])).searchParams.get('range')).toBe(`${chunkSize}-${chunkSize * 2 - 1}`);
    expect(fallback.every(([, init]) => !new Headers(init?.headers).has('range') && !new Headers(init?.headers).has('authorization'))).toBe(true);
    const fallbackPlayer = fetcher.mock.calls.find(([input, init]) => String(input).includes('/player') && JSON.parse(String(init?.body)).context.client.clientName === 'VISIONOS')!;

    expect(new Headers(fallbackPlayer[1]?.headers).get('x-youtube-client-name')).toBe('101');
    expect(JSON.parse(String(fallbackPlayer[1]?.body)).context.client.clientId).toBeUndefined();
  });

  it('does not request the fallback while native audio works', async () => {
    const fetcher = fakeUpstreams();
    const response = await bridge(fetcher, 'audio');

    await response.arrayBuffer();
    const clients = fetcher.mock.calls.filter(([input]) => String(input).includes('/player')).map(([, init]) => JSON.parse(String(init?.body)).context.client.clientName);

    expect(clients).toEqual(['ANDROID_VR', 'ANDROID']);
  });

  it('restarts from zero when a refresh changes clients even if the file lengths match', async () => {
    const fetcher = fakeUpstreams({ forbiddenClients: ['ANDROID_VR'] });
    const upstream = fetcher.getMockImplementation()!;
    let vrPlayers = 0;

    fetcher.mockImplementation(async (input, init) => {
      const url = new URL(String(input));

      if (url.pathname.includes('/player') && JSON.parse(String(init?.body)).context.client.clientName === 'ANDROID_VR' && ++vrPlayers > 1)
        return Response.json({ playabilityStatus: { status: 'LOGIN_REQUIRED' } });
      const response = await upstream(input, init);

      if (url.hostname.endsWith('.googlevideo.com') && url.searchParams.get('c') === 'ANDROID' && init?.method !== 'HEAD' && response.ok)
        return new Response(new Uint8Array(await response.arrayBuffer()).fill(8), { status: 206 });
      return response;
    });
    const response = await bridge(fetcher, 'audio');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const chunks = fetcher.mock.calls.filter(([input, init]) => new URL(String(input)).searchParams.get('c') === 'ANDROID' && init?.method !== 'HEAD');

    expect(bytes.length).toBe(chunkSize + 17);
    expect(bytes.every((byte) => byte === 8)).toBe(true);
    expect(new Headers(chunks[0][1]?.headers).get('range')).toBe(`bytes=0-${chunkSize - 1}`);
  });

  it('reports YouTube access restrictions when all clients require sign-in', async () => {
    const fetcher = fakeUpstreams({ vrUnavailable: true, androidUnavailable: true, fallbackUnavailable: true });
    const response = await bridge(fetcher, 'audio');

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ message: 'youtubeDownloadBlocked' });
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('.googlevideo.com'))).toBe(false);
  });

  it('checks the fallback stream against the upload limit before downloading it', async () => {
    const fetcher = fakeUpstreams({ vrUnavailable: true, androidUnavailable: true, size: 17, fallbackSize: 100, uploadLimit: 99 });
    const response = await bridge(fetcher, 'audio');

    expect(await response.json()).toMatchObject({ message: 'fileTooLarge', data: { max_bytes: 99 } });
    expect(fetcher.mock.calls.some(([input, init]) => String(input).includes('.googlevideo.com') && init?.method !== 'HEAD')).toBe(false);
  });

  it('enforces the workspace upload limit before requesting audio bytes', async () => {
    const fetcher = fakeUpstreams({ size: 100, uploadLimit: 99 });
    const response = await bridge(fetcher, 'audio');

    expect(await response.json()).toMatchObject({ message: 'fileTooLarge', data: { max_bytes: 99 } });
    expect(fetcher.mock.calls.some(([input, init]) => String(input).includes('.googlevideo.com') && init?.method !== 'HEAD')).toBe(false);
  });

  it('rejects stream URLs outside the YouTube CDN', async () => {
    const fetcher = fakeUpstreams({ invalidStream: true });
    const response = await bridge(fetcher, 'audio');

    expect(await response.json()).toMatchObject({ message: 'youtubeDownloadFailed' });
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('127.0.0.1'))).toBe(false);
  });

  it('rejects incomplete range responses instead of uploading corrupted audio', async () => {
    const response = await bridge(fakeUpstreams({ missingBytes: true }), 'audio');

    expect(await response.json()).toMatchObject({ message: 'youtubeDownloadFailed' });
  });

  it('reports an unavailable/private video as a metadata error', async () => {
    const response = await bridge(fakeUpstreams({ unavailable: true }));

    expect(await response.json()).toMatchObject({ message: 'youtubeMetadataFailed' });
  });
});
