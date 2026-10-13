import {
  YoutubeAudioMetadata,
  youtubeDurationError,
  youtubeVideoId,
} from '../../src/application/integrations/youtube-url';

const CHUNK_SIZE = 1024 * 1024;
const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

// Node 20.12+ and Bun support AbortSignal.any; the project's older DOM types
// do not yet declare it.
export function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  return (AbortSignal as typeof AbortSignal & { any: (values: AbortSignal[]) => AbortSignal }).any(signals);
}

const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.18 Safari/537.36',
  'accept-language': 'en-US,en;q=0.5',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
};
// These are the same clients and versions used by youtube_explode_dart 3.0.0.
const CLIENTS = [
  { clientName: 'ANDROID_VR', clientVersion: '1.56.21', deviceModel: 'Quest 3', osVersion: '12', osName: 'Android', androidSdkVersion: '32', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0 },
  { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0, osName: 'Android', osVersion: '11' },
];
// The native clients can be restricted to the first MB of a stream. Use the
// same player API with this client only after the native clients fail.
const FALLBACK_CLIENT = {
  clientName: 'VISIONOS', clientVersion: '1.02', clientId: '101', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  osName: 'visionOS', osVersion: '26.5.23O471', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0,
};

interface PlayerResponse {
  playabilityStatus?: { status?: string };
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    lengthSeconds?: string;
    isLive?: boolean;
    thumbnail?: { thumbnails?: { url: string; width: number }[] };
  };
  streamingData?: { adaptiveFormats?: PlayerFormat[]; formats?: PlayerFormat[] };
}

interface PlayerFormat {
  itag: number;
  mimeType?: string;
  url?: string;
  contentLength?: string;
  bitrate?: number;
  audioTrack?: { id?: string; displayName?: string; audioIsDefault?: boolean; isAutoDubbed?: boolean };
}

interface AudioStream {
  url: string;
  size: number;
  tag: number;
  bitrate: number;
  client: string;
  trackId?: string;
  isOriginal: boolean;
}

export class YoutubeImportError extends Error {
  constructor(readonly code: string, readonly maxBytes?: number) {
    super(code);
    this.name = 'YoutubeImportError';
  }
}

/** Read a bounded response so ignored Range headers cannot buffer an entire video. */
async function readBytes(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.body) throw new YoutubeImportError('youtubeDownloadFailed');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const next = await reader.read();

      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) throw new YoutubeImportError('youtubeDownloadFailed');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function parseWatchPlayer(html: string): PlayerResponse {
  // The player object contains nested objects and quoted braces, so match its
  // JSON boundaries rather than truncating it at the first closing brace.
  const start = /(?:var\s+)?ytInitialPlayerResponse\s*=\s*/.exec(html);

  if (!start) throw new YoutubeImportError('youtubeMetadataFailed');
  const from = start.index + start[0].length;
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = from; index < html.length; index++) {
    const char = html[index];

    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(html.slice(from, index + 1));
  }

  throw new YoutubeImportError('youtubeMetadataFailed');
}

function isAudioStreamUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      url.hostname.endsWith('.googlevideo.com') && url.pathname === '/videoplayback';
  } catch {
    return false;
  }
}

/** Server-side equivalent of Flutter's YoutubeExplodeAudioRepository. */
export class YoutubeAudioRepository {
  private readonly videoId: string;
  private readonly cookies = new Map<string, string>([['PREF', 'hl=en&tz=UTC'], ['SOCS', 'CAI'], ['GPS', '1']]);
  private visitor?: string;
  private signatureTimestamp?: string;
  private loadedMetadata?: YoutubeAudioMetadata;

  constructor(url: string, private readonly fetcher: typeof fetch = fetch) {
    const id = youtubeVideoId(url);

    if (!id) throw new YoutubeImportError('unsupportedUrl');
    this.videoId = id;
  }

  private async request(url: string, signal: AbortSignal, init: RequestInit = {}) {
    const headers = new Headers(DEFAULT_HEADERS);

    headers.set('cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    // All URLs originate from YouTube's player, never from an arbitrary proxy
    // target. Reject redirects rather than following them into another host.
    const response = await this.fetcher(url, { ...init, headers, signal, redirect: 'error' });
    const setCookie = response.headers as Headers & { getSetCookie?: () => string[] };

    for (const cookie of setCookie.getSetCookie?.() ?? []) {
      const pair = cookie.split(';', 1)[0];
      const equals = pair.indexOf('=');

      if (equals > 0) this.cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
    }

    return response;
  }

  async metadata(signal: AbortSignal, refresh = false): Promise<YoutubeAudioMetadata> {
    if (this.loadedMetadata && !refresh) return this.loadedMetadata;
    // WatchPage.get starts each player session with these native cookies.
    this.cookies.clear();
    const response = await this.request(
      `https://www.youtube.com/watch?v=${this.videoId}&bpctr=9999999999&has_verified=1&hl=en`,
      combineAbortSignals([signal, AbortSignal.timeout(30_000)]),
      { headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-us,en;q=0.5',
        'sec-fetch-mode': 'navigate',
        cookie: 'PREF=hl=en&tz=UTC; SOCS=CAI; GPS=1',
      } }
    );

    if (!response.ok) throw new YoutubeImportError('youtubeMetadataFailed');
    const html = new TextDecoder().decode(await readBytes(response, 8 * 1024 * 1024));
    const player = parseWatchPlayer(html);
    const video = player.videoDetails;

    if (player.playabilityStatus?.status !== 'OK' || video?.videoId !== this.videoId || !video.title)
      throw new YoutubeImportError('youtubeMetadataFailed');
    this.visitor = /"VISITOR_DATA":"([^"]+)"/.exec(html)?.[1];
    this.signatureTimestamp = /"STS":(\d+)/.exec(html)?.[1];
    this.cookies.set('PREF', 'hl=en');
    this.cookies.set('SOCS', 'CAI');
    this.cookies.set('GPS', '1');
    const thumbnails = video.thumbnail?.thumbnails;
    const thumbnail = Array.isArray(thumbnails) ? [...thumbnails].sort((a, b) => b.width - a.width)[0]?.url : undefined;
    const duration = video.isLive ? undefined : Number(video.lengthSeconds);

    this.loadedMetadata = {
      videoId: this.videoId,
      title: video.title,
      author: video.author ?? '',
      duration: duration && Number.isFinite(duration) && duration > 0 ? duration : undefined,
      thumbnailUrl: thumbnail?.startsWith('https://i.ytimg.com/') ? thumbnail : undefined,
    };
    return this.loadedMetadata;
  }

  private async manifest(signal: AbortSignal, preferred?: AudioStream, excludedClients: ReadonlySet<string> = new Set()): Promise<AudioStream> {
    const streams: AudioStream[] = [];
    const seen = new Set<string>();
    let blocked = false;

    for (const client of [...CLIENTS, FALLBACK_CLIENT]) {
      if (excludedClients.has(client.clientName) || (client === FALLBACK_CLIENT && streams.length > 0)) continue;
      // Native extraction retries transient failures five times, validates a
      // stream with HEAD, then falls back to the next client if it still fails.
      let player: PlayerResponse | undefined;

      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          player = await this.player(client, signal);
          break;
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof YoutubeImportError && error.code === 'youtubeDownloadBlocked') blocked = true;
          if (attempt === 4) break;
          await new Promise<void>((resolve, reject) => {
            const stopped = () => { clearTimeout(timer); reject(signal.reason); };

            const timer = setTimeout(() => { signal.removeEventListener('abort', stopped); resolve(); }, 500);

            signal.addEventListener('abort', stopped, { once: true });
          });
        }
      }

      if (player?.playabilityStatus?.status === 'LOGIN_REQUIRED') blocked = true;
      if (player?.playabilityStatus?.status !== 'OK') continue;
      const formats = player?.streamingData?.adaptiveFormats;

      if (!Array.isArray(formats)) continue;
      for (const format of formats) {
        const size = Number(format.contentLength);
        const track = format.audioTrack;
        const isOriginal = /\boriginal\b/i.test(track?.displayName ?? '');

        if (!format.mimeType?.startsWith('audio/mp4') || !format.url || !isAudioStreamUrl(format.url) ||
          !Number.isSafeInteger(size) || size <= 0) continue;
        // A higher bitrate may belong to a translated dub. Import the source
        // audio; language detection must run on what the original speaker said.
        if (track?.isAutoDubbed || (track && !isOriginal && !track.audioIsDefault)) continue;
        // YoutubeExplode deduplicates tags/tracks before bitrate selection;
        // otherwise a duplicate DRC format can replace the original audio.
        const key = `${format.itag}:${format.audioTrack?.id ?? ''}`;

        if (seen.has(key)) continue;
        seen.add(key);
        streams.push({
          url: format.url, size, tag: format.itag, bitrate: format.bitrate ?? 0,
          client: client.clientName, trackId: track?.id, isOriginal,
        });
      }
    }

    const sameTrack = preferred ? streams.filter((stream) => stream.trackId === preferred.trackId) : streams;
    const originals = sameTrack.filter((stream) => stream.isOriginal);
    const sourceStreams = originals.length ? originals : sameTrack;
    const matching = preferred ? sourceStreams.filter((stream) => stream.tag === preferred.tag) : [];
    const candidates = matching.length ? matching : sourceStreams;
    const client = preferred?.client ?? 'ANDROID_VR';
    const preferredClient = candidates.filter((stream) => stream.client === client);
    const selected = (preferredClient.length ? preferredClient : candidates).sort((a, b) => b.bitrate - a.bitrate)[0];

    if (!selected) throw new YoutubeImportError(blocked || preferred ? 'youtubeDownloadBlocked' : 'youtubeDownloadFailed');
    return selected;
  }

  private async player(client: typeof CLIENTS[number] | typeof FALLBACK_CLIENT, signal: AbortSignal): Promise<PlayerResponse | undefined> {
    // Flutter obtains a fresh watch-page session for each player client.
    await this.metadata(signal, true);
    const response = await this.request(PLAYER_URL, combineAbortSignals([signal, AbortSignal.timeout(30_000)]), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-youtube-client-name': 'clientId' in client ? client.clientId : client.clientName,
        'x-youtube-client-version': client.clientVersion,
        origin: 'https://www.youtube.com',
        'sec-fetch-mode': 'navigate',
        ...('userAgent' in client ? { 'user-agent': client.userAgent } : {}),
        ...(this.visitor ? { 'x-goog-visitor-id': this.visitor } : {}),
      },
      body: JSON.stringify({
        context: { client: Object.fromEntries(Object.entries(client).filter(([key]) => key !== 'clientId')) },
        videoId: this.videoId,
        ...(this.signatureTimestamp ? { playbackContext: { contentPlaybackContext: {
          html5Preference: 'HTML5_PREF_WANTS', signatureTimestamp: this.signatureTimestamp,
        } } } : {}),
      }),
    });

    if (!response.ok) throw new YoutubeImportError(response.status === 403 ? 'youtubeDownloadBlocked' : 'youtubeDownloadFailed');
    const player: PlayerResponse = JSON.parse(new TextDecoder().decode(await readBytes(response, 4 * 1024 * 1024)));

    // A playability failure is terminal for this client in YoutubeExplode.
    if (player.playabilityStatus?.status !== 'OK') return player;
    const first = [...(player.streamingData?.formats ?? []), ...(player.streamingData?.adaptiveFormats ?? [])]
      .find((format) => format.url && isAudioStreamUrl(format.url));

    if (!first?.url) return undefined;
    const probe = await this.request(first.url, signal, { method: 'HEAD', headers: { cookie: 'CONSENT=YES+cb' } });

    await probe.body?.cancel();
    if (probe.status === 403) throw new YoutubeImportError('youtubeDownloadBlocked');
    return player;
  }

  async audio(signal: AbortSignal, maxBytes: number) {
    const metadata = await this.metadata(signal);
    const invalidDuration = youtubeDurationError(metadata.duration);

    if (invalidDuration) throw new YoutubeImportError(invalidDuration);
    const controller = new AbortController();
    const downloadSignal = combineAbortSignals([signal, controller.signal, AbortSignal.timeout(180_000)]);
    const excludedClients = new Set<string>();
    let preferred: AudioStream | undefined;
    let initial: AudioStream;
    let iterator: AsyncGenerator<Uint8Array, void>;
    let prefix: Uint8Array[];

    for (;;) {
      initial = await this.manifest(downloadSignal, preferred, excludedClients);
      if (initial.size > maxBytes) throw new YoutubeImportError('fileTooLarge', maxBytes);
      iterator = this.chunks(initial, downloadSignal, excludedClients);
      prefix = [];
      try {
        // YouTube may serve only the first MB without stream authorization.
        // Check beyond it before sending headers, so fallback audio starts at
        // byte zero and never includes bytes from a different client/encoding.
        for (let index = 0; index < 2; index++) {
          const next = await iterator.next();

          if (next.done === false) prefix.push(next.value);
          else break;
        }

        break;
      } catch (error) {
        await iterator.return();
        if (!(error instanceof YoutubeImportError) || error.code !== 'youtubeDownloadBlocked') throw error;
        excludedClients.add(initial.client);
        preferred = initial;
        if (excludedClients.size >= CLIENTS.length + 1) throw error;
      }
    }

    let prefixIndex = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(target) {
        try {
          if (prefixIndex < prefix.length) {
            target.enqueue(prefix[prefixIndex++]);

            return;
          }

          const next = await iterator.next();

          if (next.done === false) target.enqueue(next.value);
          else target.close();
        } catch (error) {
          target.error(error);
        }
      },
      async cancel() {
        controller.abort();
        await iterator.return();
      },
    });

    return { metadata, size: initial.size, stream };
  }

  private async *chunks(initial: AudioStream, signal: AbortSignal, excludedClients: ReadonlySet<string>) {
    let current = initial;
    let downloaded = 0;
    let refreshes = 0;

    while (downloaded < initial.size) {
      signal.throwIfAborted();
      const to = Math.min(downloaded + CHUNK_SIZE, initial.size) - 1;
      const android = current.client.startsWith('ANDROID');
      const rangedUrl = new URL(current.url);

      if (!android) rangedUrl.searchParams.set('range', `${downloaded}-${to}`);
      const response = await this.request(rangedUrl.href, signal, {
        headers: { ...(android ? { range: `bytes=${downloaded}-${to}` } : {}), cookie: 'CONSENT=YES+cb' },
      });

      if (response.status === 403 && refreshes < 3) {
        await response.body?.cancel();
        refreshes++;
        current = await this.manifest(signal, current, excludedClients);
        // A different client can return the same itag and length with a
        // different encoding. Restart it during preflight; never splice it
        // into an audio response that has already started.
        if (current.client !== initial.client || current.tag !== initial.tag || current.trackId !== initial.trackId)
          throw new YoutubeImportError('youtubeDownloadBlocked');
        if (current.size !== initial.size) throw new YoutubeImportError('youtubeDownloadFailed');
        continue;
      }

      if (response.status !== 200 && response.status !== 206) {
        await response.body?.cancel();
        throw new YoutubeImportError(response.status === 403 ? 'youtubeDownloadBlocked' : 'youtubeDownloadFailed');
      }

      const expected = to - downloaded + 1;
      const bytes = await readBytes(response, expected);

      if (bytes.byteLength !== expected) throw new YoutubeImportError('youtubeDownloadFailed');
      downloaded += bytes.byteLength;
      refreshes = 0;
      yield bytes;
    }
  }
}
