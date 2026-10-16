import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

import { getAxios, initAPIService } from '../core';
import { deleteMeetingTranscript, getMeetingParagraphs, getMeetingTranscript, getMeetingUsage, submitMeetingTranscript, uploadMeetingAudio } from '../meeting-api';

jest.mock('@/application/session/token', () => ({
  captureTokenSession: jest.fn(() => ({ generation: 1, userId: 'test-user' })),
  getTokenParsed: () => ({
    access_token: 'test-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'test-user' },
  }),
  invalidToken: jest.fn(),
  invalidTokenForSession: jest.fn(),
  isTokenSessionCurrent: jest.fn(() => true),
}));
jest.mock('../gotrue', () => ({ initGrantService: jest.fn(), refreshToken: jest.fn() }));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

// Match the endpoint independently of optional query parameters.
function matchCloudPath(path: string): RegExp {
  const url = new URL(path, 'https://api.example.test').href;

  return new RegExp(`^${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?.*)?$`);
}

describe('Flutter meeting HTTP contract', () => {
  let http: MockAdapter;
  let storage: MockAdapter;
  const signedUrl = 'https://storage.example.test/audio?signature=test';
  const downloadUrl = 'https://storage.example.test/audio/download';
  const signingPath = '/api/file_storage/workspace/create_presigned_url';

  beforeAll(() => {
    initAPIService({ baseURL: 'https://api.example.test', gotrueURL: 'https://auth.example.test', wsURL: 'wss://api.example.test/ws' });
    http = new MockAdapter(getAxios()!);
    storage = new MockAdapter(axios);
  });
  afterEach(() => { http.reset(); storage.reset(); });
  afterAll(() => { http.restore(); storage.restore(); });

  it('uploads large audio via Flutter’s signed storage flow and returns the download URL without exposing AppFlowy auth to storage', async () => {
    // Matches the size that received HTTP 413 on the old direct-upload route.
    const file = new File([new Uint8Array(14_503_600)], 'youtube.m4a', { type: 'audio/mp4' });
    const onProgress = jest.fn();
    const controller = new AbortController();

    http.onPost(matchCloudPath(signingPath)).reply((request) => {
      expect(JSON.parse(request.data)).toEqual({
        content_length: file.size,
        file_key_prefix: 'audio_file_transcription',
        content_type: 'audio/mp4',
      });
      expect(request.headers?.Authorization).toBe('Bearer test-token');
      expect(request.headers?.['x-transcription-duration']).toBeUndefined();
      expect(request.signal).toBe(controller.signal);
      return [200, { code: 0, data: { upload_url: signedUrl, download_url: downloadUrl } }];
    });
    storage.onPut(signedUrl).reply((request) => {
      expect(request.data).toBe(file);
      expect(request.headers?.['Content-Type']).toBe('audio/mp4');
      expect(request.headers?.Authorization).toBeUndefined();
      expect(request.headers?.['x-transcription-duration']).toBeUndefined();
      expect(request.signal).toBe(controller.signal);
      request.onUploadProgress?.({ loaded: file.size / 2, total: file.size, bytes: file.size / 2, lengthComputable: true });
      request.onUploadProgress?.({ loaded: file.size, total: file.size, bytes: file.size / 2, lengthComputable: true });
      return [200, ''];
    });
    await expect(uploadMeetingAudio('workspace', file, controller.signal, onProgress)).resolves.toBe(downloadUrl);
    expect(onProgress.mock.calls).toEqual([[0.5], [1]]);
    expect(http.history.post).toHaveLength(1);
    const requestUrl = new URL(http.history.post[0].url!, http.history.post[0].baseURL);

    expect(requestUrl.pathname).toBe(signingPath);
    expect(requestUrl.searchParams.has('server_restore_id')).toBe(false);
    expect(storage.history.put).toHaveLength(1);
  });

  it('signs and uploads a file with an unknown MIME type consistently and supports empty 204 storage responses', async () => {
    const file = new File(['recording'], 'meeting.wav');

    http.onPost(matchCloudPath(signingPath)).reply((request) => {
      expect(JSON.parse(request.data).content_type).toBe('application/octet-stream');
      return [200, { code: 0, data: { upload_url: signedUrl, download_url: downloadUrl } }];
    });
    storage.onPut(signedUrl).reply((request) => {
      expect(request.headers?.['Content-Type']).toBe('application/octet-stream');
      return [204];
    });
    await expect(uploadMeetingAudio('workspace', file)).resolves.toBe(downloadUrl);
  });

  it('preserves a signed URL request failure without sending bytes to storage or the direct-upload route', async () => {
    http.onPost(matchCloudPath(signingPath)).reply(200, { code: 1129, message: 'Allowance resets tomorrow' });
    await expect(uploadMeetingAudio('workspace', new File(['audio'], 'meeting.m4a')))
      .rejects.toMatchObject({
        code: 1129,
        message: 'This workspace has reached its transcription limit.',
        diagnosticMessage: 'Allowance resets tomorrow',
      });
    expect(storage.history.put).toHaveLength(0);
    expect(http.history.post).toHaveLength(1);
  });

  it.each([
    {},
    { upload_url: signedUrl },
    { download_url: downloadUrl },
  ])('does not upload when either signed URL is missing (%j)', async (data) => {
    http.onPost(matchCloudPath(signingPath)).reply(200, { code: 0, data });
    await expect(uploadMeetingAudio('workspace', new File(['audio'], 'meeting.m4a'))).rejects.toThrow('Unable to obtain audio upload URL');
    expect(storage.history.put).toHaveLength(0);
  });

  it('obtains a fresh signed URL when retrying a failed storage upload', async () => {
    const refreshedUrl = `${signedUrl}-refreshed`;
    const file = new File(['audio'], 'meeting.m4a', { type: 'audio/mp4' });

    http.onPost(matchCloudPath(signingPath)).replyOnce(200, { code: 0, data: { upload_url: signedUrl, download_url: downloadUrl } });
    storage.onPut(signedUrl).replyOnce(403, 'RequestExpired');
    await expect(uploadMeetingAudio('workspace', file)).rejects.toMatchObject({ response: { status: 403 } });
    http.onPost(matchCloudPath(signingPath)).replyOnce(200, { code: 0, data: { upload_url: refreshedUrl, download_url: downloadUrl } });
    storage.onPut(refreshedUrl).replyOnce(200, '');
    await expect(uploadMeetingAudio('workspace', file)).resolves.toBe(downloadUrl);
    expect(http.history.post).toHaveLength(2);
    expect(storage.history.put.map((request) => request.url)).toEqual([signedUrl, refreshedUrl]);
  });

  it('does not start storage upload after cancellation while requesting the signed URL', async () => {
    const controller = new AbortController();

    http.onPost(matchCloudPath(signingPath)).reply(() => {
      controller.abort();
      return [200, { code: 0, data: { upload_url: signedUrl, download_url: downloadUrl } }];
    });
    await expect(uploadMeetingAudio('workspace', new File(['audio'], 'meeting.m4a'), controller.signal)).rejects.toBeTruthy();
    expect(storage.history.put).toHaveLength(0);
  });

  it('submits Flutter’s JSON model request and exact duration without a second billing call', async () => {
    const body = { audio_url: 'https://cdn.example.com/file', speaker_labels: true, speech_models: ['universal-3-pro', 'universal-2'], language_detection: true };

    http.onPost(matchCloudPath('/api/meeting/workspace/v2/transcribe-audio')).reply((request) => {
      expect(JSON.parse(request.data)).toEqual(body);
      expect(request.headers?.['x-transcription-duration']).toBe('90');
      return [200, { code: 0, data: { id: 'job', status: 'queued' } }];
    });
    await expect(submitMeetingTranscript('workspace', body, 90)).resolves.toMatchObject({ id: 'job' });
    expect(http.history.post).toHaveLength(1);
  });

  it('uses Cloud’s workspace usage endpoint with auth, including without hosted billing', async () => {
    http.onGet(matchCloudPath('/api/workspace/workspace/usage-and-limit')).reply(200, { code: 0, data: { ai_transcription_seconds: 120, ai_transcription_seconds_limit: 1800 } });
    await expect(getMeetingUsage('workspace')).resolves.toMatchObject({ ai_transcription_seconds: 120 });
    expect(http.history.get[0].headers?.Authorization).toBe('Bearer test-token');
  });

  it('encodes workspace and transcript IDs on fetch and cancellation endpoints', async () => {
    http.onGet(matchCloudPath('/api/meeting/work%2Fspace/v2/get-transcript/job%2Fid')).reply(200, { code: 0, data: { id: 'job/id', status: 'completed', text: 'Private transcript' } });
    http.onGet(matchCloudPath('/api/meeting/work%2Fspace/v2/get-paragraphs/job%2Fid')).reply(200, { code: 0, data: { paragraphs: [] } });
    http.onDelete(matchCloudPath('/api/meeting/work%2Fspace/v2/delete-transcript/job%2Fid')).reply(200, { code: 0 });
    expect((await getMeetingTranscript('work/space', 'job/id')).text).toBe('Private transcript');
    expect(await getMeetingParagraphs('work/space', 'job/id')).toEqual({ paragraphs: [] });
    await expect(deleteMeetingTranscript('work/space', 'job/id')).resolves.toBeUndefined();
  });

  it('preserves quota codes and server-declared public reset guidance', async () => {
    http.onPost(matchCloudPath('/api/meeting/workspace/v2/transcribe-audio')).reply(200, {
      code: 1129,
      message: 'Internal quota diagnostic',
      user_error: {
        schema_version: 1,
        reason: 'TRANSCRIPTION_LIMIT_REACHED',
        locale: 'en',
        message: 'Allowance resets tomorrow',
      },
    });
    await expect(submitMeetingTranscript('workspace', { audio_url: 'https://example.com/a.mp3', speaker_labels: true, speech_models: ['universal-3-pro'] }, 0))
      .rejects.toMatchObject({ code: 1129, message: 'Allowance resets tomorrow', diagnosticMessage: 'Internal quota diagnostic' });
  });

  it('forwards abort signals to the HTTP client', async () => {
    const controller = new AbortController();

    controller.abort();
    await expect(getMeetingTranscript('workspace', 'job', controller.signal)).rejects.toBeTruthy();
    expect(http.history.get).toHaveLength(0);
  });
});
