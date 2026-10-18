import { AudioTranscriptionError, readMediaDuration } from './transcription-media';
import { detectYoutubeExtension, YoutubeExtensionError } from './youtube-extension';
import { youtubeVideoId } from './youtube-url';

const MAX_BROWSER_AUDIO_BYTES = 256 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export interface YoutubeBrowserDownloadOptions {
  url: string;
  signal: AbortSignal;
  maxBytes?: number;
  onProgress?: (progress: number) => void;
}

/** Download only the audio needed for transcription, entirely in the user's browser. */
export async function downloadYoutubeAudioInBrowser({
  url, signal, maxBytes, onProgress,
}: YoutubeBrowserDownloadOptions): Promise<File> {
  const videoId = youtubeVideoId(url);

  if (!videoId) throw new AudioTranscriptionError('unsupportedUrl');
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const limit = maxBytes !== undefined && Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.min(maxBytes, MAX_BROWSER_AUDIO_BYTES) : MAX_BROWSER_AUDIO_BYTES;
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, DOWNLOAD_TIMEOUT_MS);

  signal.addEventListener('abort', abort, { once: true });
  let cleanup: (() => void) | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    if (!await detectYoutubeExtension(controller.signal)) throw new AudioTranscriptionError('youtubeExtensionRequired');
    const { createYoutubeAudioStream } = await import('./youtube-browser-stream');

    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const source = await createYoutubeAudioStream(videoId, controller.signal);

    cleanup = source.cancel;
    if (source.expectedBytes > limit) throw new AudioTranscriptionError('fileTooLarge', undefined, limit);
    const chunks: Uint8Array[] = [];
    let received = 0;

    reader = source.stream.getReader();
    const cancelReader = () => { void reader?.cancel().catch(() => undefined); };

    controller.signal.addEventListener('abort', cancelReader, { once: true });
    try {
      for (;;) {
        if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const next = await reader.read();

        if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (next.done) break;
        received += next.value.byteLength;
        if (received > limit) throw new AudioTranscriptionError('fileTooLarge', undefined, limit);
        chunks.push(next.value);
        if (source.expectedBytes > 0) onProgress?.(Math.min(received / source.expectedBytes, 0.99));
      }
    } finally {
      controller.signal.removeEventListener('abort', cancelReader);
    }

    if (!received) throw new AudioTranscriptionError('noAudio');
    if (source.expectedBytes > 0 && received < source.expectedBytes) {
      throw new AudioTranscriptionError('youtubeDownloadFailed');
    }

    const title = source.title.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').trim().slice(0, 160) || videoId;
    const extension = source.mimeType.includes('webm') ? 'webm' : 'm4a';
    const file = new File(chunks, `${title}.${extension}`, { type: source.mimeType });

    // A truncated or unplayable stream must never be submitted to the paid ASR flow.
    await readMediaDuration(file, controller.signal);
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    onProgress?.(1);
    return file;
  } catch (error) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (timedOut) throw new AudioTranscriptionError('youtubeDownloadFailed');
    if (error instanceof AudioTranscriptionError) throw error;
    if (error instanceof YoutubeExtensionError && error.code === 'unavailable') {
      throw new AudioTranscriptionError('youtubeExtensionRequired');
    }

    // Do not expose signed media URLs or integrity tokens through error telemetry.
    throw new AudioTranscriptionError('youtubeDownloadFailed');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    controller.abort();
    // Cleanup must neither expose provider errors nor prevent the other resources from closing.
    try { cleanup?.(); } catch { /* Already terminated. */ }

    try { await reader?.cancel(); } catch { /* The stream may already be errored. */ }

    try { reader?.releaseLock(); } catch { /* The reader may already be released. */ }
  }
}
