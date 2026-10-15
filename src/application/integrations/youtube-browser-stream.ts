import { VideoPlaybackAbrRequest } from 'googlevideo/protos';
import { SabrStream } from 'googlevideo/sabr-stream';
import { buildSabrFormat, EnabledTrackTypes, Logger, LogLevel, u8ToBase64 } from 'googlevideo/utils';

import { AudioTranscriptionError } from './transcription-media';
import { prepareYoutubePlayback } from './youtube-extension';

function isMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      url.hostname.endsWith('.googlevideo.com') && url.pathname === '/videoplayback';
  } catch { return false; }
}

/** Uses playback established by YouTube in the extension's dedicated helper tab. */
export async function createYoutubeAudioStream(videoId: string, signal: AbortSignal) {
  // Upstream diagnostics can include signed stream URLs and playback tokens.
  Logger.getInstance().setLogLevels(LogLevel.NONE);
  const playback = await prepareYoutubePlayback(videoId, signal);

  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (playback.videoId !== videoId || !isMediaUrl(playback.streamingUrl) ||
    !Number.isFinite(playback.duration) || playback.duration <= 0) {
    throw new AudioTranscriptionError('youtubeDownloadFailed');
  }

  const request = VideoPlaybackAbrRequest.decode(Uint8Array.from(atob(playback.requestBody), (byte) => byte.charCodeAt(0)));

  if (!request.videoPlaybackUstreamerConfig?.length || !request.streamerContext?.clientInfo ||
    !request.streamerContext.poToken?.length) throw new AudioTranscriptionError('youtubeDownloadBlocked');
  const hasDefaultAudio = playback.formats.some((format) => format.isDefaultAudioTrack === true);
  const formats = playback.formats.filter((format) =>
    !hasDefaultAudio || !format.mimeType?.startsWith('audio/') || format.isDefaultAudioTrack === true
  ).map(buildSabrFormat);
  const candidates = formats.filter((format) => format.mimeType?.startsWith('audio/'));
  // AAC in MP4 is broadly playable, and sufficient for speech transcription.
  const audioFormat = candidates.filter((format) => format.mimeType?.startsWith('audio/mp4'))
    .sort((left, right) => left.bitrate - right.bitrate)[0] ?? candidates.sort((left, right) => left.bitrate - right.bitrate)[0];
  const videoFormat = formats.find((format) => format.mimeType?.startsWith('video/'));

  if (!audioFormat || !videoFormat) throw new AudioTranscriptionError('noAudio');
  const controller = new AbortController();
  const upstreamSignals = new Set<AbortSignal>([signal]);
  let stream: SabrStream | undefined;
  const abort = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    stream?.abort();
  };

  signal.addEventListener('abort', abort, { once: true });
  const cancel = () => {
    for (const source of upstreamSignals) source.removeEventListener('abort', abort);
    upstreamSignals.clear();
    abort();
  };

  const fetchMedia: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (!isMediaUrl(url)) throw new AudioTranscriptionError('youtubeDownloadBlocked');
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);

    if (requestSignal?.aborted) abort();
    if (requestSignal && !upstreamSignals.has(requestSignal)) {
      upstreamSignals.add(requestSignal);
      requestSignal.addEventListener('abort', abort, { once: true });
    }

    const response = await fetch(input, { ...init, signal: controller.signal, credentials: 'omit', redirect: 'error' });

    if (response.redirected || (response.url && !isMediaUrl(response.url)) || [401, 403, 429].includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw new AudioTranscriptionError('youtubeDownloadBlocked');
    }

    return response;
  };

  try {
    stream = new SabrStream({
      formats,
      serverAbrStreamingUrl: playback.streamingUrl,
      videoPlaybackUstreamerConfig: u8ToBase64(request.videoPlaybackUstreamerConfig),
      poToken: u8ToBase64(request.streamerContext.poToken),
      clientInfo: request.streamerContext.clientInfo,
      durationMs: playback.duration * 1000,
      fetch: fetchMedia,
    });
    const { audioStream } = await stream.start({
      audioFormat, videoFormat, enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY, maxRetries: 3,
    });

    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return {
      title: playback.title,
      mimeType: audioFormat.mimeType!.split(';')[0],
      expectedBytes: audioFormat.contentLength ?? 0,
      stream: audioStream,
      cancel,
    };
  } catch (error) {
    cancel();
    throw error;
  }
}
