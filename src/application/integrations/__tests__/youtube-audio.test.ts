import MockAdapter from 'axios-mock-adapter';

import { getAxios, initAPIService } from '@/application/services/js-services/http/core';

import { downloadYoutubeAudio, getYoutubeAudioMetadata } from '../youtube-audio';
import { YoutubeAudioMetadata } from '../youtube-url';

jest.mock('@/application/session/token', () => ({
  getTokenParsed: () => ({ access_token: 'test-token', expires_at: Math.floor(Date.now() / 1000) + 3600 }), invalidToken: jest.fn(),
}));
jest.mock('@/application/services/js-services/http/gotrue', () => ({ initGrantService: jest.fn(), refreshToken: jest.fn() }));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const metadata: YoutubeAudioMetadata = { videoId: 'lr3hNhA0IfQ', title: 'Meeting: recording!', author: 'AppFlowy', duration: 754 };
const url = 'https://youtu.be/lr3hNhA0IfQ?si=share';

describe('YouTube browser bridge contract', () => {
  let http: MockAdapter;

  beforeAll(() => {
    initAPIService({ baseURL: 'https://cloud.example.test', gotrueURL: 'https://cloud.example.test/gotrue', wsURL: '' });
    http = new MockAdapter(getAxios()!);
  });
  afterEach(() => http.reset());
  afterAll(() => http.restore());

  it('fetches metadata from the local origin with the normal authenticated HTTP client', async () => {
    http.onGet('/api/youtube-audio').reply((config) => {
      expect(config.baseURL).toBe(window.location.origin);
      expect(config.params).toEqual({ workspace_id: 'workspace', url, action: 'metadata' });
      expect(config.headers?.Authorization).toBe('Bearer test-token');
      return [200, { code: 0, data: metadata }];
    });
    await expect(getYoutubeAudioMetadata('workspace', url, new AbortController().signal)).resolves.toEqual(metadata);
  });

  it('downloads a complete audio blob by POST and returns a safe m4a File for the existing uploader', async () => {
    const onProgress = jest.fn();

    http.onPost('/api/youtube-audio').reply((config) => {
      expect(config.params.action).toBe('audio');
      expect(config.baseURL).toBe(window.location.origin);
      expect(config.responseType).toBe('blob');
      expect(config.headers?.Authorization).toBe('Bearer test-token');
      config.onDownloadProgress?.({ loaded: 256, total: 1024, bytes: 256, lengthComputable: true, event: new ProgressEvent('progress') });
      return [200, new Blob(['audio'], { type: 'audio/mp4' })];
    });
    const file = await downloadYoutubeAudio('workspace', url, metadata, new AbortController().signal, onProgress);

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('Meeting recording.m4a');
    expect(file.type).toBe('audio/mp4');
    expect(onProgress).toHaveBeenCalledWith(256, 1024);
    expect(http.history.post).toHaveLength(1);
  });

  it('preserves quota failures for the Pro promotion', async () => {
    http.onGet('/api/youtube-audio').reply(403, { code: 1129, message: 'quotaExceeded' });
    await expect(getYoutubeAudioMetadata('workspace', url, new AbortController().signal)).rejects.toMatchObject({ code: 'quotaExceeded' });
  });

  it('keeps a too-long video distinct from an exhausted workspace quota', async () => {
    const body = new Blob([], { type: 'application/json' });

    Object.assign(body, { text: async () => JSON.stringify({ code: 400, message: 'recordingTooLong' }) });
    http.onPost('/api/youtube-audio').reply(400, body);
    await expect(downloadYoutubeAudio('workspace', url, metadata, new AbortController().signal, jest.fn())).rejects.toMatchObject({ code: 'recordingTooLong' });
  });

  it('decodes a JSON upload-size error returned as a blob without submitting a file', async () => {
    const body = new Blob([], { type: 'application/json' });

    Object.assign(body, { text: async () => JSON.stringify({ code: 400, message: 'fileTooLarge', data: { max_bytes: 99 } }) });
    http.onPost('/api/youtube-audio').reply(400, body);
    await expect(downloadYoutubeAudio('workspace', url, metadata, new AbortController().signal, jest.fn())).rejects.toMatchObject({ code: 'fileTooLarge', maxBytes: 99 });
  });

  it('keeps a YouTube access restriction distinct from a connection error', async () => {
    const body = new Blob([], { type: 'application/json' });

    Object.assign(body, { text: async () => JSON.stringify({ code: 502, message: 'youtubeDownloadBlocked' }) });
    http.onPost('/api/youtube-audio').reply(502, body);
    await expect(downloadYoutubeAudio('workspace', url, metadata, new AbortController().signal, jest.fn())).rejects.toMatchObject({ code: 'youtubeDownloadBlocked' });
  });

  it('rejects HTML/empty audio responses from a server without the bridge', async () => {
    http.onPost('/api/youtube-audio').reply(200, new Blob(['<html></html>'], { type: 'text/html' }));
    await expect(downloadYoutubeAudio('workspace', url, metadata, new AbortController().signal, jest.fn())).rejects.toMatchObject({ code: 'youtubeDownloadFailed' });
  });

  it('does not begin an HTTP request after cancellation', async () => {
    const controller = new AbortController();

    controller.abort();
    await expect(downloadYoutubeAudio('workspace', url, metadata, controller.signal, jest.fn())).rejects.toMatchObject({ name: 'AbortError' });
    expect(http.history.post).toHaveLength(0);
  });
});
