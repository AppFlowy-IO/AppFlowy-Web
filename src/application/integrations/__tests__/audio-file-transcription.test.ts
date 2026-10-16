import { AudioFileTranscription } from '../audio-file-transcription';
import { AudioTranscriptionError, readMediaDuration } from '../transcription-media';
import * as api from '@/application/services/js-services/http/meeting-api';
import { WorkspaceUsageAndLimit } from '@/application/types';

jest.mock('@/application/services/js-services/http/meeting-api', () => ({
  getMeetingUsage: jest.fn(), uploadMeetingAudio: jest.fn(), submitMeetingTranscript: jest.fn(),
  getMeetingTranscript: jest.fn(), getMeetingParagraphs: jest.fn(), deleteMeetingTranscript: jest.fn(),
  reportMeetingDuration: jest.fn(),
}));
jest.mock('../transcription-media', () => ({
  ...jest.requireActual('../transcription-media'), readMediaDuration: jest.fn(),
}));

const mocked = jest.mocked(api);
const duration = jest.mocked(readMediaDuration);
const file = () => new File(['recording'], 'Weekly_sync_123.mp4', { type: 'video/mp4' });
const direct = { url: 'https://media.example.com/meeting.mp3?token=signed' };
const allowance = (overrides: Partial<WorkspaceUsageAndLimit> = {}) => ({
  ai_transcription_seconds: 120, ai_transcription_seconds_limit: 10_000,
  single_upload_limit: 25 * 1024 * 1024, single_upload_unlimited: false, ...overrides,
} as WorkspaceUsageAndLimit);

describe('Flutter pre-recorded transcript parity', () => {
  let session: AudioFileTranscription;
  let onJob: jest.Mock;
  let onStage: jest.Mock;
  let onUsage: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    duration.mockResolvedValue(90);
    mocked.getMeetingUsage.mockResolvedValue(allowance());
    mocked.uploadMeetingAudio.mockResolvedValue('https://cdn.example.com/audio');
    mocked.submitMeetingTranscript.mockResolvedValue({ id: 'transcript-1', status: 'queued' });
    mocked.getMeetingTranscript.mockResolvedValue({ id: 'transcript-1', status: 'completed', text: 'Meeting notes' });
    mocked.getMeetingParagraphs.mockResolvedValue({ paragraphs: [] });
    mocked.deleteMeetingTranscript.mockResolvedValue(undefined);
    onJob = jest.fn(); onStage = jest.fn(); onUsage = jest.fn();
    session = new AudioFileTranscription('workspace', { onJob, onStage, onUsage });
  });
  afterEach(async () => {
    await session.cancel();
    jest.useRealTimers();
  });

  it('uploads a file, saves its job, retrieves a transcript, and leaves billing to the server', async () => {
    const audio = file();
    const result = await session.start(audio);

    expect(mocked.uploadMeetingAudio).toHaveBeenCalledWith('workspace', audio, expect.any(AbortSignal), expect.any(Function));
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledWith('workspace', expect.objectContaining({ audio_url: 'https://cdn.example.com/audio' }), 90, expect.any(AbortSignal));
    expect(onJob).toHaveBeenCalledWith('transcript-1');
    expect(result.text).toBe('Meeting notes');
    expect(onUsage).toHaveBeenCalledWith(allowance());
    expect(mocked.reportMeetingDuration).not.toHaveBeenCalled();
  });

  it('submits a direct URL without reading or uploading it, with duration zero', async () => {
    await session.start(direct);
    expect(duration).not.toHaveBeenCalled();
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledWith('workspace', expect.objectContaining({ audio_url: direct.url, speaker_labels: true }), 0, expect.any(AbortSignal));
  });

  it.each([undefined, '', 'auto', ' AUTO '])('includes universal-2 and language detection for auto (%s)', async (language) => {
    await session.start(direct, language);
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledWith('workspace', {
      audio_url: direct.url, speaker_labels: true, speech_models: ['universal-3-pro', 'universal-2'], language_detection: true,
    }, 0, expect.any(AbortSignal));
  });

  it('uses one formal model and one pass for a fixed language', async () => {
    mocked.getMeetingTranscript.mockResolvedValue({ id: 'transcript-1', status: 'completed', text: 'Bonjour', language_code: 'fr' });
    await session.start(direct, ' FR ');
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledTimes(1);
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledWith('workspace', {
      audio_url: direct.url, speaker_labels: true, speech_models: ['universal-3-pro'], language_code: 'fr',
    }, 0, expect.any(AbortSignal));
  });

  it('submits a second pass with the auto-detected language and uses its result', async () => {
    mocked.submitMeetingTranscript.mockResolvedValueOnce({ id: 'first', status: 'queued' }).mockResolvedValueOnce({ id: 'second', status: 'queued' });
    mocked.getMeetingTranscript.mockResolvedValueOnce({ id: 'first', status: 'completed', text: 'First pass', language_code: 'es' })
      .mockResolvedValueOnce({ id: 'second', status: 'completed', text: 'Refined pass', language_code: 'es' });
    const result = await session.start(direct);

    expect(mocked.submitMeetingTranscript).toHaveBeenNthCalledWith(2, 'workspace', expect.objectContaining({ language_code: 'es', speech_models: ['universal-3-pro'] }), 0, expect.any(AbortSignal));
    expect(result).toMatchObject({ id: 'second', text: 'Refined pass', language: 'es' });
    expect(onJob.mock.calls.map(([id]) => id)).toEqual(['first', 'second']);
  });

  it.each(['submit', 'fetch'])('keeps the first pass if language refinement fails during %s', async (stage) => {
    mocked.getMeetingTranscript.mockResolvedValueOnce({ id: 'first', status: 'completed', text: 'First pass', language_code: 'en' });
    if (stage === 'submit') mocked.submitMeetingTranscript.mockResolvedValueOnce({ id: 'first', status: 'queued' }).mockRejectedValueOnce(new Error('Offline'));
    else mocked.getMeetingTranscript.mockRejectedValueOnce(new Error('Offline'));
    const result = await session.start(direct);

    expect(result).toMatchObject({ id: 'first', text: 'First pass' });
    expect(onJob).toHaveBeenLastCalledWith('first');
  });

  it.each([null, '', 'auto', 'zh'])('skips refinement when detection is unavailable or unsupported (%s)', async (language) => {
    mocked.getMeetingTranscript.mockResolvedValue({ id: 'transcript-1', status: 'completed', text: 'Text', language_code: language });
    await session.start(direct);
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledTimes(1);
  });

  it('polls queued and processing jobs until completion', async () => {
    jest.useFakeTimers();
    mocked.getMeetingTranscript.mockResolvedValueOnce({ id: 'transcript-1', status: 'queued' })
      .mockResolvedValueOnce({ id: 'transcript-1', status: 'processing' })
      .mockResolvedValueOnce({ id: 'transcript-1', status: 'completed', text: 'Done' });
    const result = session.start(direct);

    await jest.advanceTimersByTimeAsync(6000);
    expect((await result).text).toBe('Done');
    expect(mocked.getMeetingTranscript).toHaveBeenCalledTimes(3);
  });

  it('limits polling to 120 attempts and can resume the same timed-out job', async () => {
    jest.useFakeTimers();
    mocked.getMeetingTranscript.mockResolvedValue({ id: 'transcript-1', status: 'processing' });
    const pending = expect(session.start(direct)).rejects.toMatchObject({ code: 'resultFailed' });

    await jest.advanceTimersByTimeAsync(360_000);
    await pending;
    expect(mocked.getMeetingTranscript).toHaveBeenCalledTimes(120);
    mocked.getMeetingTranscript.mockResolvedValue({ id: 'transcript-1', status: 'completed', text: 'Done' });
    expect((await session.retry()).text).toBe('Done');
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledTimes(1);
  });

  it('resumes a failed fetch without re-uploading, re-submitting, or checking a newly exhausted quota', async () => {
    mocked.getMeetingTranscript.mockRejectedValueOnce(new Error('Offline'));
    await expect(session.start(file())).rejects.toMatchObject({ code: 'resultFailed' });
    mocked.getMeetingUsage.mockResolvedValue(allowance({ ai_transcription_seconds: 10_000 }));
    await session.retry();
    expect(mocked.uploadMeetingAudio).toHaveBeenCalledTimes(1);
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledTimes(1);
    expect(mocked.getMeetingUsage).toHaveBeenCalledTimes(1);
  });

  it('recovers a saved transcript ID after reopening without source audio', async () => {
    await session.resume('saved-id');
    expect(mocked.getMeetingTranscript).toHaveBeenCalledWith('workspace', 'saved-id', expect.any(AbortSignal));
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
    expect(mocked.submitMeetingTranscript).not.toHaveBeenCalled();
    expect(mocked.getMeetingUsage).not.toHaveBeenCalled();
  });

  it('reuses the uploaded URL when submission fails', async () => {
    mocked.submitMeetingTranscript.mockRejectedValueOnce(new Error('Offline'));
    await expect(session.start(file())).rejects.toMatchObject({ code: 'submissionFailed' });
    await session.retry();
    expect(mocked.uploadMeetingAudio).toHaveBeenCalledTimes(1);
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledTimes(2);
  });

  it('reports upload errors and allows upload retry', async () => {
    mocked.uploadMeetingAudio.mockRejectedValueOnce(new Error('Offline'));
    await expect(session.start(file())).rejects.toMatchObject({ code: 'uploadFailed' });
    await session.retry();
    expect(mocked.uploadMeetingAudio).toHaveBeenCalledTimes(2);
  });

  it('forwards actual upload progress', async () => {
    mocked.uploadMeetingAudio.mockImplementation(async (_workspace, _file, _signal, onProgress) => {
      onProgress?.(0.25); onProgress?.(0.75);
      return 'https://cdn.example.com/audio';
    });
    await session.start(file());
    expect(onStage).toHaveBeenCalledWith('uploading', 0.25);
    expect(onStage).toHaveBeenCalledWith('uploading', 0.75);
  });

  it('falls back to transcript words/text when paragraph loading fails', async () => {
    mocked.getMeetingParagraphs.mockRejectedValue(new Error('Offline'));
    expect((await session.start(direct)).text).toBe('Meeting notes');
  });

  it('surfaces a transcription service error and allows a fresh submission', async () => {
    mocked.getMeetingTranscript.mockResolvedValueOnce({ id: 'transcript-1', status: 'error', error: 'Invalid audio' });
    await expect(session.start(direct)).rejects.toMatchObject({ code: 'serviceError', detail: 'Invalid audio' });
    await session.retry();
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledTimes(2);
  });

  it('rejects missing audio and empty transcripts', async () => {
    await expect(session.retry()).rejects.toMatchObject({ code: 'noAudio' });
    mocked.getMeetingTranscript.mockResolvedValue({ id: 'transcript-1', status: 'completed', text: '' });
    await expect(session.start(direct)).rejects.toMatchObject({ code: 'noTranscript' });
  });

  it('does not start if reading the audio duration fails', async () => {
    duration.mockRejectedValue(new AudioTranscriptionError('unableReadDuration'));
    await expect(session.start(file())).rejects.toMatchObject({ code: 'unableReadDuration' });
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
  });

  it.each([10_000, 10_001])('blocks exhausted allowances at %s seconds before upload', async (used) => {
    mocked.getMeetingUsage.mockResolvedValue(allowance({ ai_transcription_seconds: used }));
    await expect(session.start(file())).rejects.toMatchObject({ code: 'quotaExceeded' });
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
    expect(mocked.submitMeetingTranscript).not.toHaveBeenCalled();
  });

  it('blocks a file longer than the remaining allowance', async () => {
    mocked.getMeetingUsage.mockResolvedValue(allowance({ ai_transcription_seconds: 9970 }));
    await expect(session.start(file())).rejects.toMatchObject({ code: 'recordingTooLong' });
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
  });

  it('rechecks remaining time before resubmitting an already uploaded file', async () => {
    mocked.submitMeetingTranscript.mockRejectedValueOnce(new Error('Offline'));
    await expect(session.start(file())).rejects.toMatchObject({ code: 'submissionFailed' });
    mocked.getMeetingUsage.mockResolvedValue(allowance({ ai_transcription_seconds: 9970 }));
    await expect(session.retry()).rejects.toMatchObject({ code: 'recordingTooLong' });
    expect(mocked.uploadMeetingAudio).toHaveBeenCalledTimes(1);
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledTimes(1);
  });

  it('preserves authoritative server quota errors', async () => {
    const error = { code: 1129, message: 'Allowance resets tomorrow' };

    mocked.submitMeetingTranscript.mockRejectedValue(error);
    await expect(session.start(direct)).rejects.toBe(error);
  });

  it('defers to older servers when transcription allowance fields are absent', async () => {
    mocked.getMeetingUsage.mockResolvedValue(allowance({ ai_transcription_seconds: undefined, ai_transcription_seconds_limit: undefined }));
    await session.start(direct);
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledTimes(1);
  });

  it('does not upload when checking usage fails', async () => {
    mocked.getMeetingUsage.mockRejectedValue(new Error('Offline'));
    await expect(session.start(file())).rejects.toThrow('Offline');
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
  });

  it('validates file formats, URL protocols, and the workspace upload limit', async () => {
    await expect(session.start(new File(['x'], 'text.txt'))).rejects.toMatchObject({ code: 'unsupportedFormat' });
    await expect(session.start({ url: 'file:///etc/recording.mp3' })).rejects.toMatchObject({ code: 'unsupportedUrl' });
    mocked.getMeetingUsage.mockResolvedValue(allowance({ single_upload_limit: 1 }));
    await expect(session.start(file())).rejects.toMatchObject({ code: 'fileTooLarge', maxBytes: 1 });
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
  });

  it('honors unlimited upload size', async () => {
    mocked.getMeetingUsage.mockResolvedValue(allowance({ single_upload_limit: 1, single_upload_unlimited: true }));
    await session.start(file());
    expect(mocked.uploadMeetingAudio).toHaveBeenCalledTimes(1);
  });

  it('rejects concurrent transcription in another block and releases its lock on cancellation', async () => {
    jest.useFakeTimers();
    mocked.getMeetingTranscript.mockResolvedValue({ id: 'transcript-1', status: 'processing' });
    const pending = expect(session.start(direct)).rejects.toMatchObject({ name: 'AbortError' });

    await jest.advanceTimersByTimeAsync(0);
    const other = new AudioFileTranscription('workspace', { onJob, onStage, onUsage });

    await expect(other.start(direct)).rejects.toMatchObject({ code: 'alreadyTranscribing' });
    await session.cancel();
    await pending;
    expect(mocked.deleteMeetingTranscript).toHaveBeenCalledWith('workspace', 'transcript-1');
    mocked.getMeetingTranscript.mockResolvedValue({ id: 'transcript-2', status: 'completed', text: 'Next recording' });
    await other.start(direct);
    await other.cancel();
  });

  it('navigation aborts polling without deleting a saved transcript', async () => {
    jest.useFakeTimers();
    mocked.getMeetingTranscript.mockResolvedValue({ id: 'transcript-1', status: 'processing' });
    const pending = expect(session.start(direct)).rejects.toMatchObject({ name: 'AbortError' });

    await jest.advanceTimersByTimeAsync(0);
    session.suspend();
    await pending;
    expect(mocked.deleteMeetingTranscript).not.toHaveBeenCalled();
    expect(session.canRetry).toBe(true);
  });
});
