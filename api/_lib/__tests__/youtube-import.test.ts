/** @jest-environment node */
import { YoutubeCaptionRepository } from '../youtube';
import { handleYoutubeImport } from '../youtube-import';

const videoId = 'lr3hNhA0IfQ';
const cloud = 'https://cloud.example.com';

function track(language = 'en', auto = false, url?: string) {
  return {
    languageCode: language,
    baseUrl: url ?? `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${language}&signature=private`,
    name: { simpleText: `${language}${auto ? ' (auto-generated)' : ''}` },
    ...(auto ? { kind: 'asr' } : {}),
  };
}

function request(action = 'metadata', options: { authenticated?: boolean; headers?: Record<string, string>; language?: string; url?: string; workspace?: string; signal?: AbortSignal; method?: string } = {}) {
  const url = new URL('http://localhost:3002/api/youtube-audio');

  url.searchParams.set('url', options.url ?? `https://youtu.be/${videoId}?si=share`);
  url.searchParams.set('workspace_id', options.workspace ?? 'workspace');
  url.searchParams.set('action', action);
  if (options.language) url.searchParams.set('language', options.language);
  return new Request(url, { method: options.method ?? 'GET', signal: options.signal, headers: {
    ...(options.authenticated === false ? {} : { authorization: 'Bearer appflowy-session' }), ...options.headers,
  } });
}

function fakeUpstreams(options: {
  tracks?: ReturnType<typeof track>[]; defaultCaptionIndex?: number; captionBody?: string; captionStatus?: number;
  watchStatus?: number; playability?: string; usageStatus?: number; usageCode?: number; duration?: string;
  watchPlayability?: string; watchReason?: string; usageUnreachable?: boolean;
} = {}) {
  return jest.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    init?.signal?.throwIfAborted();
    const url = new URL(String(input));

    if (url.origin === cloud) {
      if (options.usageUnreachable) throw new TypeError('fetch failed');
      return Response.json({ code: options.usageCode ?? 0, data: {
        ai_transcription_seconds: 1800, ai_transcription_seconds_limit: 1800, single_upload_limit: 0,
      } }, { status: options.usageStatus ?? 200 });
    }

    if (url.pathname === '/watch') return new Response(`<script>var ytInitialPlayerResponse = ${JSON.stringify({
      playabilityStatus: { status: options.watchPlayability ?? 'OK', ...(options.watchReason ? { reason: options.watchReason } : {}) },
      videoDetails: { videoId, title: 'Team {meeting} "recording"', author: 'AppFlowy', lengthSeconds: options.duration ?? '120' },
    })};</script>`, { status: options.watchStatus ?? 200 });
    if (url.pathname === '/youtubei/v1/player') return Response.json({
      playabilityStatus: { status: options.playability ?? 'OK' },
      videoDetails: { videoId },
      captions: { playerCaptionsTracklistRenderer: {
        captionTracks: options.tracks ?? [track()], defaultAudioTrackIndex: 0,
        audioTracks: [{ defaultCaptionTrackIndex: options.defaultCaptionIndex ?? 0 }],
      } },
    });
    if (url.pathname === '/api/timedtext') return new Response(options.captionBody ?? JSON.stringify({ events: [
      { tStartMs: 0, dDurationMs: 130000, id: 1 },
      { tStartMs: 1200, dDurationMs: 2300, segs: [{ utf8: 'Welcome ' }, { utf8: 'to our meeting.' }] },
      { tStartMs: 2000, dDurationMs: 1000, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 4000, dDurationMs: 1500, segs: [{ utf8: 'Review\nour progress & plans.' }] },
    ] }), { status: options.captionStatus ?? 200 });
    throw new Error(`Unexpected upstream ${url.origin}${url.pathname}`);
  });
}

function bridge(fetcher: ReturnType<typeof fakeUpstreams>, action = 'metadata', options: Parameters<typeof request>[1] = {}) {
  return handleYoutubeImport(request(action, options), { baseURL: cloud, fetcher: fetcher as unknown as typeof fetch });
}

function captionRequests(fetcher: ReturnType<typeof fakeUpstreams>) {
  return fetcher.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/api/timedtext');
}

describe('authenticated YouTube caption import', () => {
  it('rejects unauthenticated, cross-site and obsolete audio requests without any upstream request', async () => {
    const fetcher = fakeUpstreams();

    expect((await bridge(fetcher, 'captions', { authenticated: false })).status).toBe(401);
    expect((await bridge(fetcher, 'captions', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await bridge(fetcher, 'audio', { method: 'POST' })).status).toBe(405);
    expect((await bridge(fetcher, 'metadata', { method: 'POST' })).status).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { url: 'https://youtube.com.attacker.example/watch?v=lr3hNhA0IfQ' },
    { url: 'http://localhost/private' },
    { workspace: '../other-workspace' },
    { language: '../private' },
  ])('validates user-supplied URL, workspace and language before upstream requests: %p', async (options) => {
    const fetcher = fakeUpstreams();

    expect((await bridge(fetcher, 'captions', options)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns metadata and available caption languages while keeping credentials away from YouTube', async () => {
    const fetcher = fakeUpstreams();
    const response = await bridge(fetcher);

    expect(await response.json()).toMatchObject({ code: 0, data: {
      videoId, title: 'Team {meeting} "recording"', author: 'AppFlowy', duration: 120,
      captionLanguages: [{ code: 'en', isAutoGenerated: false }],
    } });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer appflowy-session');
    expect(fetcher.mock.calls.slice(1).every(([, init]) => !new Headers(init?.headers).has('authorization') && init?.redirect === 'error')).toBe(true);
    expect(captionRequests(fetcher)).toHaveLength(0);
  });

  it('imports text and seconds without transcription allowance, file upload or media download', async () => {
    const fetcher = fakeUpstreams();
    const response = await bridge(fetcher, 'captions');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: 0, data: {
      videoId, language: 'en', isAutoGenerated: false,
      segments: [
        { text: 'Welcome to our meeting.', start: 1.2, end: 3.5 },
        { text: 'Review our progress & plans.', start: 4, end: 5.5 },
      ],
    } });
    expect(fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      '/api/workspace/workspace/usage-and-limit', '/watch', '/youtubei/v1/player', '/api/timedtext',
    ]);
    const [input, init] = captionRequests(fetcher)[0];

    expect(new URL(String(input)).searchParams.get('fmt')).toBe('json3');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });

  it('does not impose audio transcription duration limits on caption text', async () => {
    const fetcher = fakeUpstreams({ duration: '12' });

    expect((await bridge(fetcher, 'captions')).status).toBe(200);
  });

  it.each([{ usageStatus: 403 }, { usageCode: 1012 }])('verifies workspace access before contacting YouTube: %p', async (options) => {
    const fetcher = fakeUpstreams(options);

    expect((await (await bridge(fetcher, 'captions')).json()).message).toBe('usageFailed');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([{ usageUnreachable: true }, { usageStatus: 500 }, { usageStatus: 503 }])('reports a usage service that is down as an AppFlowy outage, not a link problem: %p', async (options) => {
    const fetcher = fakeUpstreams(options);
    const response = await bridge(fetcher);

    expect(response.status).toBe(503);
    expect((await response.json()).message).toBe('usageUnavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('tags every response with a request id for the dialog details line', async () => {
    const ok = await bridge(fakeUpstreams());
    const failed = await bridge(fakeUpstreams({ usageStatus: 403 }));

    expect(ok.headers.get('x-request-id')).toMatch(/^[0-9a-f]{8,12}$/);
    expect(failed.headers.get('x-request-id')).toMatch(/^[0-9a-f]{8,12}$/);
    expect(ok.headers.get('x-request-id')).not.toBe(failed.headers.get('x-request-id'));
  });

  it.each([
    { watchPlayability: 'ERROR', watchReason: 'Video unavailable' },
    { watchPlayability: 'UNPLAYABLE', watchReason: 'The uploader has not made this video available in your country' },
    { watchPlayability: 'LOGIN_REQUIRED', watchReason: 'Sign in to confirm your age' },
    { watchPlayability: 'LOGIN_REQUIRED', watchReason: 'Private video' },
  ])('reports a video the viewer cannot play as unavailable instead of a metadata failure: %p', async (options) => {
    const fetcher = fakeUpstreams(options);
    const response = await bridge(fetcher);

    expect(response.status).toBe(404);
    expect((await response.json()).message).toBe('youtubeVideoUnavailable');
    expect(fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(['/api/workspace/workspace/usage-and-limit', '/watch']);
  });

  it.each([
    { watchPlayability: 'LOGIN_REQUIRED', watchReason: 'Sign in to confirm you’re not a bot' },
    { watchPlayability: 'LOGIN_REQUIRED' },
    { watchStatus: 429 },
    { watchStatus: 403 },
  ])('reports YouTube bot gating or rate limiting at the metadata stage as blocked: %p', async (options) => {
    const fetcher = fakeUpstreams(options);
    const response = await bridge(fetcher);

    expect(response.status).toBe(502);
    expect((await response.json()).message).toBe('youtubeBlocked');
  });

  it('prioritizes the default audio language and manual captions within that language, deduplicating metadata languages', async () => {
    const fetcher = fakeUpstreams({ tracks: [track('fr'), track('en', true), track('en')], defaultCaptionIndex: 1 });
    const metadata = await (await bridge(fetcher)).json();

    expect(metadata.data.captionLanguages).toEqual([
      { code: 'en', name: 'en', isAutoGenerated: false }, { code: 'fr', name: 'fr', isAutoGenerated: false },
    ]);
    const data = await (await bridge(fetcher, 'captions')).json();

    expect(data.data).toMatchObject({ language: 'en', isAutoGenerated: false });
  });

  it.each(['fr', 'fr-CA'])('selects an explicitly requested available language %s without translation', async (language) => {
    const fetcher = fakeUpstreams({ tracks: [track('en', true), track('fr')] });
    const result = await (await bridge(fetcher, 'captions', { language })).json();

    expect(result.data.language).toBe('fr');
    const url = new URL(String(captionRequests(fetcher)[0][0]));

    expect(url.searchParams.get('lang')).toBe('fr');
    expect(url.searchParams.has('tlang')).toBe(false);
  });

  it('falls back to an existing default track when the requested language is unavailable', async () => {
    const fetcher = fakeUpstreams();

    expect((await (await bridge(fetcher, 'captions', { language: 'de' })).json()).data.language).toBe('en');
  });

  it.each([
    'http://www.youtube.com/api/timedtext',
    'https://www.youtube.com:8443/api/timedtext',
    'https://name:secret@www.youtube.com/api/timedtext',
    'https://www.youtube.com.attacker.example/api/timedtext',
    'https://www.youtube.com/redirect',
    'https://rr1.googlevideo.com/videoplayback',
    'https://127.0.0.1/api/timedtext',
  ])('never follows a caption URL outside the precise text endpoint: %s', async (base) => {
    const fetcher = fakeUpstreams({ tracks: [track('en', false, `${base}?v=${videoId}&lang=en`)] });

    expect((await (await bridge(fetcher, 'captions')).json()).message).toBe('youtubeCaptionsUnavailable');
    expect(captionRequests(fetcher)).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&tlang=fr`,
    'https://www.youtube.com/api/timedtext?v=otherVideo1&lang=en',
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=fr`,
  ])('rejects translated or mismatched track URLs: %s', async (url) => {
    const fetcher = fakeUpstreams({ tracks: [track('en', false, url)] });

    expect((await (await bridge(fetcher, 'captions')).json()).message).toBe('youtubeCaptionsUnavailable');
    expect(captionRequests(fetcher)).toHaveLength(0);
  });

  it.each([403, 429])('reports upstream blocking (%s) distinctly', async (captionStatus) => {
    const fetcher = fakeUpstreams({ captionStatus });

    expect(await (await bridge(fetcher, 'captions')).json()).toMatchObject({ message: 'youtubeCaptionsBlocked' });
  });

  it('reports a bot-gated player as blocked without requesting caption URLs', async () => {
    const fetcher = fakeUpstreams({ playability: 'LOGIN_REQUIRED' });

    expect((await (await bridge(fetcher, 'captions')).json()).message).toBe('youtubeBlocked');
    expect(captionRequests(fetcher)).toHaveLength(0);
  });

  it.each([{ tracks: [] }, { captionBody: '' }, { captionBody: '{"events":[]}' }])('reports missing or empty captions instead of falling back to media: %p', async (options) => {
    const fetcher = fakeUpstreams(options);

    expect((await (await bridge(fetcher, 'captions')).json()).message).toBe('youtubeCaptionsUnavailable');
  });

  it.each([
    '<html>upstream error</html>',
    '{"events":[{"tStartMs":-1,"dDurationMs":100,"segs":[{"utf8":"text"}]}]}',
    '{"events":[{"tStartMs":1e999,"dDurationMs":100,"segs":[{"utf8":"text"}]}]}',
    '{"events":[{"tStartMs":1,"dDurationMs":-100,"segs":[{"utf8":"text"}]}]}',
    '{"events":[{"tStartMs":1,"dDurationMs":100,"segs":[{"utf8":123}]}]}',
    '{"events":[{"tStartMs":1,"segs":[{"utf8":"text"}]}]}',
  ])('rejects malformed captions and invalid timestamps (%#)', async (captionBody) => {
    const fetcher = fakeUpstreams({ captionBody });

    expect((await (await bridge(fetcher, 'captions')).json()).message).toBe('youtubeCaptionsFailed');
  });

  it('rejects excessive text and cue counts', async () => {
    for (const events of [
      [{ tStartMs: 0, dDurationMs: 1, segs: [{ utf8: 'x'.repeat(1_000_001) }] }],
      Array.from({ length: 25_001 }, (_, index) => ({ tStartMs: index, dDurationMs: 1, segs: [{ utf8: 'text' }] })),
    ]) {
      const fetcher = fakeUpstreams({ captionBody: JSON.stringify({ events }) });

      expect((await (await bridge(fetcher, 'captions')).json()).message).toBe('youtubeCaptionsFailed');
    }
  });

  it('cancels an oversized caption body while reading it', async () => {
    const fetcher = fakeUpstreams();
    const upstream = fetcher.getMockImplementation()!;
    const cancel = jest.fn();

    fetcher.mockImplementation(async (input, init) => new URL(String(input)).pathname === '/api/timedtext' ?
      new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel })) :
      upstream(input, init));
    expect((await (await bridge(fetcher, 'captions')).json()).message).toBe('youtubeCaptionsFailed');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('forbids redirects to arbitrary hosts', async () => {
    const fetcher = fakeUpstreams({ captionStatus: 302 });

    expect((await (await bridge(fetcher, 'captions')).json()).message).toBe('youtubeCaptionsFailed');
    expect(captionRequests(fetcher)[0][1]?.redirect).toBe('error');
  });

  it('cancels caption body reading when the client disconnects', async () => {
    const controller = new AbortController();
    const fetcher = fakeUpstreams();
    const upstream = fetcher.getMockImplementation()!;
    const cancel = jest.fn();

    fetcher.mockImplementation(async (input, init) => {
      if (new URL(String(input)).pathname !== '/api/timedtext') return upstream(input, init);
      return new Response(new ReadableStream({ pull() { controller.abort(); }, cancel }));
    });
    const response = await bridge(fetcher, 'captions', { signal: controller.signal });

    expect(response.status).toBe(502);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(captionRequests(fetcher)).toHaveLength(1);
  });
});

const liveTest = process.env.RUN_YOUTUBE_CAPTION_LIVE_TEST === '1' ? it : it.skip;

liveTest('retrieves real caption text for the reported YouTube video without requesting media', async () => {
  const paths: string[] = [];
  const textOnlyFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));

    // Fail before fetching if a future implementation attempts a media download.
    expect(url.origin).toBe('https://www.youtube.com');
    expect(['/watch', '/youtubei/v1/player', '/api/timedtext']).toContain(url.pathname);
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    paths.push(url.pathname);
    return fetch(input, init);
  };

  const repository = new YoutubeCaptionRepository('https://www.youtube.com/watch?v=W2zbKF5z1cs&list=RDW2zbKF5z1cs&start_radio=1', textOnlyFetch);
  const signal = AbortSignal.timeout(60_000);
  const metadata = await repository.metadata(signal);
  const transcript = await repository.captions(signal);

  expect(metadata.videoId).toBe('W2zbKF5z1cs');
  expect(metadata.captionLanguages?.length).toBeGreaterThan(0);
  expect(transcript.language).toBe('en');
  expect(transcript.segments.length).toBeGreaterThan(0);
  expect(transcript.segments.every((cue) => cue.text.trim() && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end >= cue.start)).toBe(true);
  expect(paths).toEqual(['/watch', '/youtubei/v1/player', '/api/timedtext']);
}, 65_000);
