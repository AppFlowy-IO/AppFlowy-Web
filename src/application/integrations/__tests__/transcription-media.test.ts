import { isDirectMediaUrl, isServiceImportError, isSupportedTranscriptionFile, isTransientImportError, isYoutubeUrl, readMediaDuration, titleFromAudioFile, TRANSCRIPTION_EXTENSIONS } from '../transcription-media';

describe('Flutter transcript sources', () => {
  it.each(TRANSCRIPTION_EXTENSIONS)('accepts %s recordings and signed direct links', (extension) => {
    expect(isSupportedTranscriptionFile(`Meeting.${extension.toUpperCase()}`)).toBe(true);
    expect(isDirectMediaUrl(`https://media.example.com/Meeting.${extension}?signature=abc#fragment`)).toBe(true);
  });

  it.each(['javascript:meeting.mp3', 'file:///recording.mp3', 'https://example.com/page', '/relative.mp4', 'https://user:password@example.com/a.mp3', 'https://example.com/%invalid.mp3'])('rejects non-media/unsafe URL %s', (value) => {
    expect(isDirectMediaUrl(value)).toBe(false);
  });

  it('accepts an encoded filename and HTTP media', () => {
    expect(isDirectMediaUrl('http://example.com/my%20meeting.MP3?key=abc')).toBe(true);
  });

  it.each(['https://youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk', 'https://youtu.be/abcdefghijk', 'https://m.youtube.com/watch?v=abcdefghijk'])('recognizes native YouTube source %s', (url) => {
    expect(isYoutubeUrl(url)).toBe(true);
  });

  it('does not recognize a spoofed YouTube host', () => {
    expect(isYoutubeUrl('https://youtube.com.example.com/watch?v=x')).toBe(false);
    expect(isYoutubeUrl('javascript:youtube.com')).toBe(false);
  });

  it('strips the extension and recording timestamp for the default meeting title', () => {
    expect(titleFromAudioFile('Weekly_sync_123456.mp4')).toBe('Weekly_sync');
    expect(titleFromAudioFile('Meeting.notes.m4a')).toBe('Meeting.notes');
    expect(titleFromAudioFile('Meeting_recording.mp3')).toBe('Meeting_recording');
  });
});

describe('reading media duration', () => {
  let audio: HTMLAudioElement;
  let originalCreate: typeof document.createElement;
  let create: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    originalCreate = document.createElement.bind(document);
    audio = originalCreate('audio');
    audio.load = jest.fn();
    URL.createObjectURL = jest.fn(() => 'blob:recording');
    URL.revokeObjectURL = jest.fn();
    create = jest.spyOn(document, 'createElement').mockImplementation((tagName, options) => tagName === 'audio' ? audio : originalCreate(tagName, options));
  });
  afterEach(() => { create.mockRestore(); jest.useRealTimers(); });

  it('uses whole seconds like Duration.inSeconds and releases its object URL', async () => {
    Object.defineProperty(audio, 'duration', { value: 125.9 });
    const result = readMediaDuration(new File(['a'], 'recording.mp4'), new AbortController().signal);

    audio.dispatchEvent(new Event('loadedmetadata'));
    expect(await result).toBe(125);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:recording');
    expect(audio.hasAttribute('src')).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([NaN, Infinity, 0, -1])('reports unreadable duration %s and cleans up', async (duration) => {
    Object.defineProperty(audio, 'duration', { value: duration });
    const pending = expect(readMediaDuration(new File(['a'], 'a.mp4'), new AbortController().signal)).rejects.toMatchObject({ code: 'unableReadDuration' });

    audio.dispatchEvent(new Event('loadedmetadata'));
    await pending;
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('reports decoder errors', async () => {
    const pending = expect(readMediaDuration(new File(['a'], 'a.mp4'), new AbortController().signal)).rejects.toMatchObject({ code: 'unableReadDuration' });

    audio.dispatchEvent(new Event('error'));
    await pending;
  });

  it('times out an unresponsive decoder', async () => {
    const pending = expect(readMediaDuration(new File(['a'], 'a.mp4'), new AbortController().signal)).rejects.toMatchObject({ code: 'unableReadDuration' });

    jest.advanceTimersByTime(30_000);
    await pending;
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('supports cancellation and releases decoder resources', async () => {
    const controller = new AbortController();
    const pending = expect(readMediaDuration(new File(['a'], 'a.mp4'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await pending;
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not allocate a decoder when already cancelled', async () => {
    const controller = new AbortController();

    controller.abort();
    await expect(readMediaDuration(new File(['a'], 'a.mp4'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe('import error classes', () => {
  it('offers Retry only for failures that can change on a later attempt', () => {
    for (const code of ['usageUnavailable', 'networkError', 'youtubeBlocked', 'youtubeMetadataFailed', 'youtubeCaptionsFailed', 'youtubeCaptionsBlocked'] as const) {
      expect(isTransientImportError(code)).toBe(true);
    }

    for (const code of ['unsupportedUrl', 'youtubeVideoUnavailable', 'youtubeCaptionsUnavailable', 'quotaExceeded', undefined] as const) {
      expect(isTransientImportError(code)).toBe(false);
    }
  });

  it('hides the upload fallback only for AppFlowy-side failures', () => {
    for (const code of ['usageFailed', 'usageUnavailable', 'networkError'] as const) expect(isServiceImportError(code)).toBe(true);
    for (const code of ['youtubeBlocked', 'youtubeVideoUnavailable', 'youtubeMetadataFailed', undefined] as const) expect(isServiceImportError(code)).toBe(false);
  });
});
