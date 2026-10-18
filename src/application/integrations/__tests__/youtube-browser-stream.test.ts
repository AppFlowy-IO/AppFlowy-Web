/** @jest-environment node */
import { ReadableStream } from 'node:stream/web';

import { VideoPlaybackAbrRequest } from 'googlevideo/protos';
import { SabrStream } from 'googlevideo/sabr-stream';
import { buildSabrFormat, EnabledTrackTypes, Logger, LogLevel, u8ToBase64 } from 'googlevideo/utils';

import { createYoutubeAudioStream } from '../youtube-browser-stream';
import { prepareYoutubePlayback } from '../youtube-extension';

jest.mock('googlevideo/protos', () => ({ VideoPlaybackAbrRequest: { decode: jest.fn() } }), { virtual: true });
jest.mock('googlevideo/sabr-stream', () => ({ SabrStream: jest.fn() }), { virtual: true });
jest.mock('googlevideo/utils', () => ({
  buildSabrFormat: jest.fn(), u8ToBase64: jest.fn(),
  EnabledTrackTypes: { AUDIO_ONLY: 1 }, LogLevel: { NONE: 0 },
  Logger: { getInstance: jest.fn() },
}), { virtual: true });
jest.mock('../youtube-extension', () => ({ prepareYoutubePlayback: jest.fn() }));

const prepare = jest.mocked(prepareYoutubePlayback);
const Sabr = jest.mocked(SabrStream);
const decode = jest.mocked(VideoPlaybackAbrRequest.decode);
const mockFetch = jest.fn();
const originalFetch = global.fetch;
const mockStart = jest.fn();
const mockAbort = jest.fn();
const mockLogs = jest.fn();
const videoId = 'W2zbKF5z1cs';
const mediaUrl = 'https://rr1---sn-test.googlevideo.com/videoplayback?sig=test';
const audioLow = { itag: 139, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 48000, contentLength: 400 };
const audioHigh = { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, contentLength: 800 };
const audioWebm = { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 32000, contentLength: 300 };
const video = { itag: 134, mimeType: 'video/mp4; codecs="avc1.4d401e"', bitrate: 500000, contentLength: 10000 };
const playback = {
  videoId, title: 'Recording', duration: 130,
  streamingUrl: mediaUrl, requestBody: btoa('request'),
  formats: [video, audioHigh, audioWebm, audioLow],
};
let audioStream: ReadableStream<Uint8Array>;
let videoStream: ReadableStream<Uint8Array>;

function engineOptions() {
  return Sabr.mock.calls[0][0];
}

function responseFor(url = mediaUrl, status = 200) {
  const response = new Response(new Uint8Array([1, 2]), { status });

  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function fetchDuringStart(input: RequestInfo | URL = mediaUrl, init?: RequestInit) {
  mockStart.mockImplementationOnce(async () => {
    await engineOptions().fetch(input, init);
    return { audioStream, videoStream };
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  audioStream = new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
  videoStream = new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
  prepare.mockResolvedValue(playback);
  decode.mockReturnValue({
    videoPlaybackUstreamerConfig: new Uint8Array([1]),
    streamerContext: { clientInfo: { clientName: 1 }, poToken: new Uint8Array([2]) },
  });
  jest.mocked(buildSabrFormat).mockImplementation((format) => format);
  jest.mocked(u8ToBase64).mockImplementation((bytes) => Buffer.from(bytes).toString('base64'));
  jest.mocked(Logger.getInstance).mockReturnValue({ setLogLevels: mockLogs });
  Sabr.mockImplementation(() => ({ start: mockStart, abort: mockAbort }));
  mockStart.mockResolvedValue({ audioStream, videoStream });
  mockFetch.mockImplementation(async () => responseFor());
  global.fetch = mockFetch;
});
afterEach(() => { global.fetch = originalFetch; });

describe('YouTube browser audio stream', () => {
  it('selects low-bitrate AAC and only exposes the audio stream for transcription', async () => {
    const signal = new AbortController().signal;
    const result = await createYoutubeAudioStream(videoId, signal);

    expect(prepare).toHaveBeenCalledWith(videoId, signal);
    expect(mockStart).toHaveBeenCalledWith({ audioFormat: audioLow, videoFormat: video, enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY, maxRetries: 3 });
    expect(result.stream).toBe(audioStream);
    expect(result.stream).not.toBe(videoStream);
    expect(result).toMatchObject({ title: 'Recording', mimeType: 'audio/mp4', expectedBytes: 400 });
    expect(mockLogs).toHaveBeenCalledWith(LogLevel.NONE);
    result.cancel();
  });

  it('uses the available audio format when AAC is absent', async () => {
    prepare.mockResolvedValue({ ...playback, formats: [video, audioWebm] });
    const result = await createYoutubeAudioStream(videoId, new AbortController().signal);

    expect(result.mimeType).toBe('audio/webm');
    expect(mockStart.mock.calls[0][0].audioFormat).toBe(audioWebm);
    result.cancel();
  });

  it('keeps the default language track even when a dubbed audio track has a lower bitrate', async () => {
    const defaultAudio = { ...audioHigh, isDefaultAudioTrack: true };
    const dubbedAudio = { ...audioLow, isDefaultAudioTrack: false };

    prepare.mockResolvedValue({ ...playback, formats: [video, dubbedAudio, audioWebm, defaultAudio] });
    const result = await createYoutubeAudioStream(videoId, new AbortController().signal);

    expect(mockStart.mock.calls[0][0].audioFormat).toBe(defaultAudio);
    expect(engineOptions().formats).toEqual([video, defaultAudio]);
    expect(result.expectedBytes).toBe(defaultAudio.contentLength);
    result.cancel();
  });

  it.each([
    { videoId: 'differentId' },
    { streamingUrl: 'https://app.appflowy.io/api/youtube-audio' },
    { streamingUrl: 'https://googlevideo.com.attacker.test/videoplayback' },
    { streamingUrl: 'http://rr1.googlevideo.com/videoplayback' },
    { streamingUrl: 'https://user:password@rr1.googlevideo.com/videoplayback' },
    { streamingUrl: 'https://rr1.googlevideo.com/other-path' },
    { duration: 0 },
    { duration: Number.POSITIVE_INFINITY },
  ])('rejects mismatched or unsafe helper metadata (%j)', async (overrides) => {
    prepare.mockResolvedValue({ ...playback, ...overrides });
    await expect(createYoutubeAudioStream(videoId, new AbortController().signal)).rejects.toMatchObject({ code: 'youtubeDownloadFailed' });
    expect(Sabr).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects Googlevideo endpoints on unexpected ports', async () => {
    prepare.mockResolvedValue({ ...playback, streamingUrl: 'https://rr1.googlevideo.com:8443/videoplayback' });
    await expect(createYoutubeAudioStream(videoId, new AbortController().signal)).rejects.toMatchObject({ code: 'youtubeDownloadFailed' });
    expect(Sabr).not.toHaveBeenCalled();
  });

  it('does not construct a stream or fetch media if cancelled as helper preparation completes', async () => {
    const controller = new AbortController();

    prepare.mockImplementationOnce(async () => { controller.abort(); return playback; });
    await expect(createYoutubeAudioStream(videoId, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(Sabr).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('requires verified playback configuration and a proof-of-origin token', async () => {
    decode.mockReturnValue({ streamerContext: { clientInfo: {}, poToken: new Uint8Array() } });
    await expect(createYoutubeAudioStream(videoId, new AbortController().signal)).rejects.toMatchObject({ code: 'youtubeDownloadBlocked' });
    expect(Sabr).not.toHaveBeenCalled();
  });

  it('rejects video-only playback before starting media transfer', async () => {
    prepare.mockResolvedValue({ ...playback, formats: [video] });
    await expect(createYoutubeAudioStream(videoId, new AbortController().signal)).rejects.toMatchObject({ code: 'noAudio' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(Sabr).not.toHaveBeenCalled();
  });

  it('fetches media directly with credentials omitted and redirects rejected', async () => {
    fetchDuringStart(mediaUrl, { method: 'POST', body: new Uint8Array([1]), credentials: 'include', redirect: 'follow' });
    const result = await createYoutubeAudioStream(videoId, new AbortController().signal);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(mediaUrl, expect.objectContaining({ method: 'POST', credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) }));
    expect(new URL(mockFetch.mock.calls[0][0]).hostname.endsWith('.googlevideo.com')).toBe(true);
    result.cancel();
  });

  it.each([
    'https://app.appflowy.io/api/youtube-audio',
    'https://www.youtube.com/watch?v=W2zbKF5z1cs',
    'https://googlevideo.com.attacker.test/videoplayback',
    'https://rr1.googlevideo.com/other-path',
  ])('rejects an unexpected fetch destination (%s)', async (destination) => {
    fetchDuringStart(destination);
    await expect(createYoutubeAudioStream(videoId, new AbortController().signal)).rejects.toMatchObject({ code: 'youtubeDownloadBlocked' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockAbort).toHaveBeenCalledTimes(1);
  });

  it('aborts playback when native fetch rejects a redirect', async () => {
    const error = new TypeError('Unexpected redirect');

    mockFetch.mockRejectedValueOnce(error);
    fetchDuringStart();
    await expect(createYoutubeAudioStream(videoId, new AbortController().signal)).rejects.toBe(error);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1].redirect).toBe('error');
    expect(mockAbort).toHaveBeenCalledTimes(1);
  });

  it.each(['redirected', 'host'])('rejects an unexpected %s response before it reaches the audio decoder', async (kind) => {
    const response = responseFor(kind === 'host' ? 'https://attacker.test/media' : mediaUrl);
    const cancel = jest.spyOn(response.body!, 'cancel');

    if (kind === 'redirected') Object.defineProperty(response, 'redirected', { value: true });
    mockFetch.mockResolvedValueOnce(response);
    fetchDuringStart();
    await expect(createYoutubeAudioStream(videoId, new AbortController().signal)).rejects.toMatchObject({ code: 'youtubeDownloadBlocked' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mockAbort).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 429])('reports a %s media response as blocked and cancels its body', async (status) => {
    const response = responseFor(mediaUrl, status);
    const cancel = jest.spyOn(response.body!, 'cancel');

    mockFetch.mockResolvedValueOnce(response);
    fetchDuringStart();
    await expect(createYoutubeAudioStream(videoId, new AbortController().signal)).rejects.toMatchObject({ code: 'youtubeDownloadBlocked' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mockAbort).toHaveBeenCalledTimes(1);
  });

  it('aborts native network requests and SABR playback, and removes all listeners during cancellation', async () => {
    const controller = new AbortController();
    const requestController = new AbortController();
    const removeOuter = jest.spyOn(controller.signal, 'removeEventListener');
    const removeRequest = jest.spyOn(requestController.signal, 'removeEventListener');
    const result = await createYoutubeAudioStream(videoId, controller.signal);
    let networkSignal!: AbortSignal;

    mockFetch.mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
      networkSignal = init.signal;
      networkSignal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    }));
    const outcome = expect(engineOptions().fetch(mediaUrl, { signal: requestController.signal })).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await outcome;
    expect(networkSignal.aborted).toBe(true);
    expect(mockAbort).toHaveBeenCalledTimes(1);
    result.cancel();
    expect(removeOuter).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(removeRequest).toHaveBeenCalledWith('abort', expect.any(Function));
    result.cancel();
    expect(mockAbort).toHaveBeenCalledTimes(1);
  });

  it('also stops SABR when its individual Request signal aborts', async () => {
    const controller = new AbortController();
    const result = await createYoutubeAudioStream(videoId, new AbortController().signal);

    await engineOptions().fetch(new Request(mediaUrl, { signal: controller.signal }));
    controller.abort();
    expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(mockAbort).toHaveBeenCalledTimes(1);
    result.cancel();
  });
});
