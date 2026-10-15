/** @jest-environment node */
import { ReadableStream } from 'node:stream/web';

import { AudioTranscriptionError, readMediaDuration } from '../transcription-media';
import { downloadYoutubeAudioInBrowser } from '../youtube-browser-download';
import { createYoutubeAudioStream } from '../youtube-browser-stream';
import { detectYoutubeExtension, YoutubeExtensionError } from '../youtube-extension';

jest.mock('../transcription-media', () => ({
  ...jest.requireActual('../transcription-media'), readMediaDuration: jest.fn(),
}));
jest.mock('../youtube-extension', () => ({
  ...jest.requireActual('../youtube-extension'), detectYoutubeExtension: jest.fn(),
}));
jest.mock('../youtube-browser-stream', () => ({ createYoutubeAudioStream: jest.fn() }), { virtual: true });

const detect = jest.mocked(detectYoutubeExtension);
const createStream = jest.mocked(createYoutubeAudioStream);
const duration = jest.mocked(readMediaDuration);
const url = 'https://www.youtube.com/watch?v=W2zbKF5z1cs&list=RDW2zbKF5z1cs&start_radio=1';

function source({
  chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])],
  expectedBytes = 4,
  mimeType = 'audio/webm',
  close = true,
} = {}) {
  const cancelStream = jest.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (close) controller.close();
    },
    cancel: cancelStream,
  });
  const result = { title: 'Weekly: review', mimeType, expectedBytes, stream, cancel: jest.fn() };

  createStream.mockResolvedValue(result);
  return { ...result, cancelStream };
}

function stalledSource() {
  let started!: () => void;
  const reading = new Promise<void>((resolve) => { started = resolve; });
  const cancelStream = jest.fn();
  const stream = new ReadableStream<Uint8Array>({ pull: () => started(), cancel: cancelStream }, { highWaterMark: 0 });
  const result = { title: 'Recording', mimeType: 'audio/webm', expectedBytes: 100, stream, cancel: jest.fn() };

  createStream.mockResolvedValue(result);
  return { ...result, reading, cancelStream };
}

beforeEach(() => {
  jest.resetAllMocks();
  detect.mockResolvedValue(true);
  duration.mockResolvedValue(130);
});
afterEach(() => jest.useRealTimers());

describe('YouTube browser audio download', () => {
  it('requires the extension before creating a YouTube stream', async () => {
    detect.mockResolvedValue(false);
    await expect(downloadYoutubeAudioInBrowser({ url, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'youtubeExtensionRequired' });
    expect(createStream).not.toHaveBeenCalled();
    expect(duration).not.toHaveBeenCalled();
  });

  it('maps extension disconnection to installation guidance', async () => {
    createStream.mockRejectedValue(new YoutubeExtensionError('unavailable'));
    await expect(downloadYoutubeAudioInBrowser({ url, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'youtubeExtensionRequired' });
  });

  it('rejects an invalid link without contacting the extension', async () => {
    await expect(downloadYoutubeAudioInBrowser({ url: 'https://example.com/video', signal: new AbortController().signal })).rejects.toMatchObject({ code: 'unsupportedUrl' });
    expect(detect).not.toHaveBeenCalled();
    expect(createStream).not.toHaveBeenCalled();
  });

  it('does not start work for an already cancelled request', async () => {
    const controller = new AbortController();

    controller.abort();
    await expect(downloadYoutubeAudioInBrowser({ url, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(detect).not.toHaveBeenCalled();
  });

  it.each([
    ['audio/webm', 'webm'],
    ['audio/mp4', 'm4a'],
  ])('returns a playable %s file with real progress and releases its stream', async (mimeType, extension) => {
    const audio = source({ mimeType });
    const onProgress = jest.fn();

    duration.mockImplementation(async () => {
      expect(onProgress).not.toHaveBeenCalledWith(1);
      return 130;
    });
    const file = await downloadYoutubeAudioInBrowser({ url, signal: new AbortController().signal, onProgress });

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe(`Weekly_ review.${extension}`);
    expect(file.type).toBe(mimeType);
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 2, 3, 4]);
    expect(createStream).toHaveBeenCalledWith('W2zbKF5z1cs', expect.any(AbortSignal));
    expect(duration).toHaveBeenCalledWith(file, expect.any(AbortSignal));
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([0.5, 0.99, 1]);
    expect(audio.cancel).toHaveBeenCalledTimes(1);
    expect(audio.stream.locked).toBe(false);
    expect(createStream.mock.calls[0][1].aborted).toBe(true);
  });

  it('does not invent a download percentage when the total size is unknown', async () => {
    source({ expectedBytes: 0 });
    const onProgress = jest.fn();

    await downloadYoutubeAudioInBrowser({ url, signal: new AbortController().signal, onProgress });
    expect(onProgress.mock.calls).toEqual([[1]]);
  });

  it('rejects a known oversized stream before reading media bytes', async () => {
    const audio = source({ expectedBytes: 101 });
    const reader = jest.spyOn(audio.stream, 'getReader');

    await expect(downloadYoutubeAudioInBrowser({ url, signal: new AbortController().signal, maxBytes: 100 })).rejects.toMatchObject({ code: 'fileTooLarge', maxBytes: 100 });
    expect(reader).not.toHaveBeenCalled();
    expect(audio.cancel).toHaveBeenCalledTimes(1);
    expect(duration).not.toHaveBeenCalled();
  });

  it('enforces the workspace limit while reading an unknown-size stream', async () => {
    const audio = source({ expectedBytes: 0, close: false });

    await expect(downloadYoutubeAudioInBrowser({ url, signal: new AbortController().signal, maxBytes: 3 })).rejects.toMatchObject({ code: 'fileTooLarge', maxBytes: 3 });
    expect(duration).not.toHaveBeenCalled();
    expect(audio.cancel).toHaveBeenCalledTimes(1);
    expect(audio.cancelStream).toHaveBeenCalledTimes(1);
    expect(audio.stream.locked).toBe(false);
  });

  it('caps browser memory even when the workspace allows larger uploads', async () => {
    source({ expectedBytes: 256 * 1024 * 1024 + 1 });
    await expect(downloadYoutubeAudioInBrowser({ url, signal: new AbortController().signal, maxBytes: 1024 * 1024 * 1024 })).rejects.toMatchObject({ code: 'fileTooLarge', maxBytes: 256 * 1024 * 1024 });
    expect(duration).not.toHaveBeenCalled();
  });

  it('does not return an empty file for transcription', async () => {
    const audio = source({ chunks: [], expectedBytes: 0 });
    const onProgress = jest.fn();

    await expect(downloadYoutubeAudioInBrowser({ url, signal: new AbortController().signal, onProgress })).rejects.toMatchObject({ code: 'noAudio' });
    expect(duration).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(audio.cancel).toHaveBeenCalledTimes(1);
    expect(audio.stream.locked).toBe(false);
  });

  it('does not mark an unplayable file complete or return it for transcription', async () => {
    const audio = source();
    const onProgress = jest.fn();

    duration.mockRejectedValue(new AudioTranscriptionError('unableReadDuration'));
    await expect(downloadYoutubeAudioInBrowser({ url, signal: new AbortController().signal, onProgress })).rejects.toMatchObject({ code: 'unableReadDuration' });
    expect(onProgress).not.toHaveBeenCalledWith(1);
    expect(audio.cancel).toHaveBeenCalledTimes(1);
    expect(audio.stream.locked).toBe(false);
  });

  it('rejects a stream that closes before its advertised audio size without submitting a partial file', async () => {
    const audio = source({ expectedBytes: 100 });
    const onProgress = jest.fn();

    await expect(downloadYoutubeAudioInBrowser({ url, signal: new AbortController().signal, onProgress })).rejects.toMatchObject({ code: 'youtubeDownloadFailed' });
    expect(duration).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalledWith(1);
    expect(audio.cancel).toHaveBeenCalledTimes(1);
    expect(audio.stream.locked).toBe(false);
  });

  it('cancels a stalled read promptly, releases resources, and preserves intentional cancellation', async () => {
    const audio = stalledSource();
    const controller = new AbortController();
    const onProgress = jest.fn();
    const outcome = expect(downloadYoutubeAudioInBrowser({ url, signal: controller.signal, onProgress })).rejects.toMatchObject({ name: 'AbortError' });

    await audio.reading;
    controller.abort();
    await outcome;
    expect(audio.cancelStream).toHaveBeenCalledTimes(1);
    expect(audio.cancel).toHaveBeenCalledTimes(1);
    expect(audio.stream.locked).toBe(false);
    expect(duration).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('times out a stalled download and removes its deadline timer', async () => {
    jest.useFakeTimers();
    const audio = stalledSource();
    const outcome = expect(downloadYoutubeAudioInBrowser({ url, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'youtubeDownloadFailed' });

    await audio.reading;
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    await outcome;
    expect(audio.cancel).toHaveBeenCalledTimes(1);
    expect(audio.cancelStream).toHaveBeenCalledTimes(1);
    expect(audio.stream.locked).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not return a file when cancelled as media validation finishes', async () => {
    source();
    const controller = new AbortController();
    const onProgress = jest.fn();
    let started!: () => void;
    let finish!: (duration: number) => void;
    const validating = new Promise<void>((resolve) => { started = resolve; });

    duration.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => { finish = resolve; });
    });
    const outcome = expect(downloadYoutubeAudioInBrowser({ url, signal: controller.signal, onProgress })).rejects.toMatchObject({ name: 'AbortError' });

    await validating;
    finish(130);
    controller.abort();
    await outcome;
    expect(onProgress).not.toHaveBeenCalledWith(1);
  });

  it('still releases the reader and preserves a safe error if stream cleanup throws', async () => {
    const audio = source({ chunks: [], expectedBytes: 0 });

    audio.cancel.mockImplementation(() => { throw new Error('Cleanup https://media.googlevideo.com/?pot=private-token'); });
    await expect(downloadYoutubeAudioInBrowser({ url, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'noAudio' });
    expect(audio.stream.locked).toBe(false);
  });

  it('redacts signed URLs and tokens from unexpected downloader errors', async () => {
    const sensitive = 'https://media.googlevideo.com/videoplayback?sig=private-signature&pot=private-token';

    createStream.mockRejectedValue(new Error(`Download failed for ${sensitive}`));
    const error = await downloadYoutubeAudioInBrowser({ url, signal: new AbortController().signal }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(AudioTranscriptionError);
    expect(error).toMatchObject({ code: 'youtubeDownloadFailed', message: 'youtubeDownloadFailed' });
    expect(error).not.toHaveProperty('detail', expect.anything());
    expect(JSON.stringify(error)).not.toContain('private-');
  });
});
