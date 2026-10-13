import axios from 'axios';

import { WorkspaceUsageAndLimit } from '@/application/types';

import { executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

export interface MeetingWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: string | null;
}

export interface MeetingParagraph {
  text: string;
  start: number;
  end: number;
  confidence?: number;
  words?: MeetingWord[];
}

export interface MeetingTranscript {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string | null;
  audio_duration?: number | null;
  language_code?: string | null;
  words?: MeetingWord[];
  error?: string | null;
}

export interface MeetingTranscriptRequest {
  audio_url: string;
  speaker_labels: boolean;
  speech_models: string[];
  language_code?: string;
  language_detection?: boolean;
}

const meetingPath = (workspaceId: string) => `/api/meeting/${encodeURIComponent(workspaceId)}/v2`;

/** Usage is a Cloud resource, including on servers without hosted billing. */
export function getMeetingUsage(workspaceId: string, signal?: AbortSignal) {
  return executeAPIRequest<WorkspaceUsageAndLimit>(() =>
    getAxios()?.get(`/api/workspace/${encodeURIComponent(workspaceId)}/usage-and-limit`, { signal, timeout: 15_000 })
  );
}

/** Flutter's release flow uploads bytes to storage, avoiding Cloud's request-body limit. */
export async function uploadMeetingAudio(
  workspaceId: string,
  file: File,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void
) {
  const contentType = file.type || 'application/octet-stream';
  const signed = await executeAPIRequest<{ upload_url: string; download_url: string }>(
    () =>
      getAxios()?.post(`/api/file_storage/${encodeURIComponent(workspaceId)}/create_presigned_url`, {
        content_length: file.size,
        file_key_prefix: 'audio_file_transcription',
        content_type: contentType,
      }, {
        signal,
        timeout: 30_000,
      }),
    { suppressResponseDataLogging: true }
  );

  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!signed?.upload_url || !signed.download_url) throw new Error('Unable to obtain audio upload URL');

  // The signed URL authorizes this PUT. Never send AppFlowy's bearer token to storage.
  await axios.put(signed.upload_url, file, {
    signal,
    timeout: 300_000,
    headers: { 'Content-Type': contentType },
    onUploadProgress: ({ loaded, total }) => {
      if (total && !signal?.aborted) onProgress?.(Math.min(loaded / total, 1));
    },
  });
  return signed.download_url;
}

export function submitMeetingTranscript(
  workspaceId: string,
  request: MeetingTranscriptRequest,
  duration: number,
  signal?: AbortSignal
) {
  return executeAPIRequest<MeetingTranscript>(
    () =>
      getAxios()?.post(`${meetingPath(workspaceId)}/transcribe-audio`, request, {
        signal,
        timeout: 30_000,
        headers: { 'x-transcription-duration': String(duration) },
      }),
    { suppressResponseDataLogging: true }
  );
}

export function getMeetingTranscript(workspaceId: string, transcriptId: string, signal?: AbortSignal) {
  return executeAPIRequest<MeetingTranscript>(
    () =>
      getAxios()?.get(`${meetingPath(workspaceId)}/get-transcript/${encodeURIComponent(transcriptId)}`, {
        signal,
        timeout: 30_000,
      }),
    { suppressResponseDataLogging: true }
  );
}

export function getMeetingParagraphs(workspaceId: string, transcriptId: string, signal?: AbortSignal) {
  return executeAPIRequest<{ paragraphs: MeetingParagraph[] }>(
    () =>
      getAxios()?.get(`${meetingPath(workspaceId)}/get-paragraphs/${encodeURIComponent(transcriptId)}`, {
        signal,
        timeout: 30_000,
      }),
    { suppressResponseDataLogging: true }
  );
}

export function deleteMeetingTranscript(workspaceId: string, transcriptId: string) {
  return executeAPIVoidRequest(() =>
    getAxios()?.delete(`${meetingPath(workspaceId)}/delete-transcript/${encodeURIComponent(transcriptId)}`, {
      timeout: 15_000,
    })
  );
}

export function getMeetingStreamingToken(workspaceId: string, signal?: AbortSignal) {
  return executeAPIRequest<{ token: string; expires_in_seconds: number }>(
    () =>
      getAxios()?.post(
        `/api/meeting/${encodeURIComponent(workspaceId)}/v2/streaming-token`,
        {
          expires_in_seconds: 60,
          max_session_duration_seconds: 10_800,
        },
        { signal, timeout: 30_000 }
      ),
    { suppressResponseDataLogging: true }
  );
}

export function reportMeetingDuration(workspaceId: string, seconds: number) {
  return executeAPIRequest<{ remaining_duration: number }>(() =>
    getAxios()?.post(
      `/api/meeting/${encodeURIComponent(workspaceId)}/v2/update-used-transcribe-duration`,
      {
        used_duration: seconds,
      },
      { timeout: 15_000 }
    )
  );
}
