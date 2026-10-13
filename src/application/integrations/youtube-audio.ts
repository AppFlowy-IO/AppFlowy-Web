import axios from 'axios';

import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';

import { AudioTranscriptionError, TranscriptionErrorCode } from './transcription-media';
import { isTranscriptionLimitError } from './transcription-usage';
import { YoutubeAudioMetadata, youtubeAudioFilename } from './youtube-url';

const API_PATH = '/api/youtube-audio';
const KNOWN_ERRORS: TranscriptionErrorCode[] = [
  'usageFailed', 'unsupportedUrl', 'quotaExceeded', 'recordingTooLong', 'fileTooLarge',
  'youtubeMetadataFailed', 'youtubeDownloadFailed', 'youtubeDownloadBlocked', 'youtubeDurationUnavailable', 'youtubeDurationOutOfRange',
];

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
}

async function importError(error: unknown, fallback: 'youtubeMetadataFailed' | 'youtubeDownloadFailed') {
  let detail = error as { code?: number; message?: string; data?: { max_bytes?: number } };

  if (axios.isAxiosError(error)) {
    const body = error.response?.data;

    if (body instanceof Blob) {
      try { detail = JSON.parse(await body.text()); } catch { /* Interrupted streams have no JSON error body. */ }
    } else if (body && typeof body === 'object') detail = body;
  }

  if (isTranscriptionLimitError(detail)) return new AudioTranscriptionError('quotaExceeded', detail);
  const code = KNOWN_ERRORS.find((candidate) => candidate === detail?.message) ?? fallback;

  return new AudioTranscriptionError(code, detail, detail?.data?.max_bytes);
}

export async function getYoutubeAudioMetadata(workspaceId: string, url: string, signal: AbortSignal) {
  try {
    return await executeAPIRequest<YoutubeAudioMetadata>(
      () => getAxios()?.get(API_PATH, {
        baseURL: window.location.origin,
        params: { workspace_id: workspaceId, url, action: 'metadata' },
        signal, timeout: 35_000,
      }),
      { suppressResponseDataLogging: true }
    );
  } catch (error) {
    checkCancelled(signal);
    throw await importError(error, 'youtubeMetadataFailed');
  }
}

export async function downloadYoutubeAudio(
  workspaceId: string,
  url: string,
  metadata: YoutubeAudioMetadata,
  signal: AbortSignal,
  onProgress: (loaded: number, total?: number) => void
) {
  try {
    // POST avoids automatic GET retries after a partial download. Retry is
    // explicit in the dialog and never submits a transcription job twice.
    const response = await getAxios()?.post<Blob>(API_PATH, undefined, {
      baseURL: window.location.origin,
      params: { workspace_id: workspaceId, url, action: 'audio' },
      responseType: 'blob', signal, timeout: 210_000,
      onDownloadProgress: ({ loaded, total }) => {
        if (!signal.aborted) onProgress(loaded, total);
      },
    });

    checkCancelled(signal);
    if (!response?.data?.size || !response.data.type.startsWith('audio/'))
      throw new AudioTranscriptionError('youtubeDownloadFailed');
    return new File([response.data], youtubeAudioFilename(metadata.title), { type: 'audio/mp4' });
  } catch (error) {
    checkCancelled(signal);
    if (error instanceof AudioTranscriptionError) throw error;
    throw await importError(error, 'youtubeDownloadFailed');
  }
}

/** Invoke from the click handler to retain the browser's clipboard activation. */
export function readTranscriptionClipboard(): Promise<string> {
  try {
    return navigator.clipboard?.readText().catch(() => '') ?? Promise.resolve('');
  } catch {
    return Promise.resolve('');
  }
}
