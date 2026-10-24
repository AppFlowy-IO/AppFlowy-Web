import { youtubeVideoId } from './youtube-url';

export const TRANSCRIPTION_EXTENSIONS = [
  'mp3',
  'mp4',
  'mpeg',
  'mpga',
  'm4a',
  'wav',
  'webm',
  'flac',
  'aac',
  'ogg',
  'opus',
  'mov',
] as const;
export const TRANSCRIPTION_FILE_ACCEPT = TRANSCRIPTION_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export type TranscriptionErrorCode =
  | 'usageFailed'
  | 'usageUnavailable'
  | 'networkError'
  | 'unsupportedFormat'
  | 'fileTooLarge'
  | 'unableReadDuration'
  | 'uploadFailed'
  | 'submissionFailed'
  | 'resultFailed'
  | 'serviceError'
  | 'unsupportedUrl'
  | 'youtubeMetadataFailed'
  | 'youtubeVideoUnavailable'
  | 'youtubeBlocked'
  | 'youtubeCaptionsUnavailable'
  | 'youtubeCaptionsBlocked'
  | 'youtubeCaptionsFailed'
  | 'noAudio'
  | 'noTranscript'
  | 'alreadyTranscribing'
  | 'recordingTooLong'
  | 'quotaExceeded';

export class AudioTranscriptionError extends Error {
  constructor(readonly code: TranscriptionErrorCode, readonly detail?: unknown, readonly maxBytes?: number) {
    super(code);
    this.name = 'AudioTranscriptionError';
  }
}

const TRANSIENT_IMPORT_ERRORS = new Set<TranscriptionErrorCode>([
  'usageFailed', 'usageUnavailable', 'networkError', 'uploadFailed', 'submissionFailed', 'resultFailed',
  'youtubeMetadataFailed', 'youtubeBlocked', 'youtubeCaptionsBlocked', 'youtubeCaptionsFailed',
]);
const SERVICE_IMPORT_ERRORS = new Set<TranscriptionErrorCode>(['usageFailed', 'usageUnavailable', 'networkError']);

/** Retry is offered only when a later attempt can plausibly succeed; input, policy and availability errors are permanent. */
export function isTransientImportError(code: TranscriptionErrorCode | undefined) {
  return code !== undefined && TRANSIENT_IMPORT_ERRORS.has(code);
}

/** The failure is on AppFlowy's side or the user's connection, so uploading a file would fail the same way. */
export function isServiceImportError(code: TranscriptionErrorCode | undefined) {
  return code !== undefined && SERVICE_IMPORT_ERRORS.has(code);
}

export function isSupportedTranscriptionFile(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();

  return TRANSCRIPTION_EXTENSIONS.some((supported) => supported === extension);
}

/** Only absolute HTTP(S) media URLs are accepted, as in the Flutter dialog. */
export function isDirectMediaUrl(value: string) {
  try {
    const url = new URL(value.trim());

    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      isSupportedTranscriptionFile(decodeURIComponent(url.pathname))
    );
  } catch {
    return false;
  }
}

export function isYoutubeUrl(value: string) {
  return Boolean(youtubeVideoId(value));
}

export function titleFromAudioFile(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/_\d+$/, '');
}

/** Read the duration without uploading a local recording or retaining its object URL. */
export function readMediaDuration(file: File, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'));
      return;
    }

    const media = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
      URL.revokeObjectURL(url);
    };

    const abort = () => {
      cleanup();
      reject(new DOMException('Cancelled', 'AbortError'));
    };

    const fail = () => {
      cleanup();
      reject(new AudioTranscriptionError('unableReadDuration'));
    };

    const timer = setTimeout(fail, 30_000);

    media.preload = 'metadata';
    media.onloadedmetadata = () => {
      const duration = media.duration;

      if (!Number.isFinite(duration) || duration <= 0) {
        fail();
        return;
      }

      cleanup();
      // Flutter uses Duration.inSeconds; the server remains the billing authority.
      resolve(Math.floor(duration));
    };

    media.onerror = fail;
    signal.addEventListener('abort', abort, { once: true });
    media.src = url;
  });
}
