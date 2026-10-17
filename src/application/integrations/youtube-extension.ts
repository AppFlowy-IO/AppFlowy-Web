const PROTOCOL = 'appflowy-youtube-v1';

type ExtensionErrorCode = 'unavailable' | 'blocked' | 'timeout' | 'failed' | 'too-large';
interface ExtensionReply {
  id: string;
  ok: boolean;
  version?: number;
  error?: string;
  playback?: YoutubePlayback;
}

export interface YoutubePlaybackFormat {
  itag: number;
  mimeType: string;
  bitrate: number;
  lastModified?: string;
  contentLength?: string;
  approxDurationMs?: string;
  averageBitrate?: number;
  width?: number;
  height?: number;
  quality?: string;
  qualityLabel?: string;
  audioQuality?: string;
  audioTrackId?: string;
  isDefaultAudioTrack?: boolean;
  xtags?: string;
}

export interface YoutubePlayback {
  videoId: string;
  title: string;
  duration: number;
  streamingUrl: string;
  requestBody: string;
  formats: YoutubePlaybackFormat[];
}

export class YoutubeExtensionError extends Error {
  constructor(public readonly code: ExtensionErrorCode) {
    super(`YouTube extension: ${code}`);
    this.name = 'YoutubeExtensionError';
  }
}

function abortError() {
  return new DOMException('Cancelled', 'AbortError');
}

/** A presentation hint only; detectYoutubeExtension verifies that the worker is responding. */
export function isYoutubeExtensionAvailable(): boolean {
  return typeof window !== 'undefined' &&
    (window as Window & { appflowyYoutube?: { version?: number } }).appflowyYoutube?.version === 1;
}

function extensionRequest(
  operation: 'ping' | 'preparePlayback',
  request: unknown,
  signals: (AbortSignal | undefined)[],
  timeout: number
): Promise<ExtensionReply> {
  if (signals.some((signal) => signal?.aborted)) return Promise.reject(abortError());
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return new Promise((resolve, reject) => {
    const send = (nextOperation: string) => window.postMessage({
      protocol: PROTOCOL, direction: 'page', id, operation: nextOperation,
      ...(nextOperation === 'preparePlayback' ? { request } : {}),
    }, window.location.origin);
    const cleanUp = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      for (const signal of signals) signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanUp();
      send('cancel');
      reject(abortError());
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const response = event.data as ExtensionReply & { protocol?: string; direction?: string };

      if (!response || response.protocol !== PROTOCOL || response.direction !== 'extension' || response.id !== id) return;
      cleanUp();
      if (response.ok === true) {
        resolve(response);
      } else if (response.error === 'aborted') {
        reject(abortError());
      } else {
        const code = ['unavailable', 'blocked', 'timeout', 'too-large'].includes(response.error || '') ?
          response.error as ExtensionErrorCode : 'failed';

        reject(new YoutubeExtensionError(code));
      }
    };

    const timer = setTimeout(() => {
      cleanUp();
      send('cancel');
      reject(new YoutubeExtensionError(operation === 'ping' ? 'unavailable' : 'timeout'));
    }, timeout);

    window.addEventListener('message', onMessage);
    for (const signal of signals) signal?.addEventListener('abort', onAbort, { once: true });
    send(operation);
  });
}

export async function detectYoutubeExtension(signal?: AbortSignal): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const reply = await extensionRequest('ping', undefined, [signal], 1800);

    return reply.version === 1;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return false;
  }
}

/** Ask the local helper to prepare the requested video's native playback session. */
export async function prepareYoutubePlayback(videoId: string, signal: AbortSignal): Promise<YoutubePlayback> {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) throw new YoutubeExtensionError('blocked');
  const reply = await extensionRequest('preparePlayback', { videoId }, [signal], 95_000);
  const playback = reply.playback;

  if (!playback || playback.videoId !== videoId || typeof playback.title !== 'string' ||
    !Number.isFinite(playback.duration) || playback.duration <= 0 || typeof playback.streamingUrl !== 'string' ||
    typeof playback.requestBody !== 'string' || playback.requestBody.length > 349_528 ||
    !Array.isArray(playback.formats) || !playback.formats.length || playback.formats.length > 256) {
    throw new YoutubeExtensionError('failed');
  }

  const url = new URL(playback.streamingUrl);

  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
    !/^[a-zA-Z0-9-]+\.googlevideo\.com$/.test(url.hostname) || url.pathname !== '/videoplayback') {
    throw new YoutubeExtensionError('blocked');
  }

  return playback;
}
