import { executeAPIRequest, getAxios } from './core';

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
