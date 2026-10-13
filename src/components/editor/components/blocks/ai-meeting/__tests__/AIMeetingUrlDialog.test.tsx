import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import translations from '@/@types/translations/en.json';
import { AudioTranscriptionError } from '@/application/integrations/transcription-media';
import { downloadYoutubeAudio, getYoutubeAudioMetadata } from '@/application/integrations/youtube-audio';
import { YoutubeAudioMetadata } from '@/application/integrations/youtube-url';

import { AIMeetingUrlDialog } from '../AIMeetingUrlDialog';
import { AIMeetingImportActions } from '../AIMeetingImport';
import { AIMeetingImportState } from '../useAIMeetingImport';

const mockT = (key: string, options?: Record<string, unknown>) => {
  const value = key.split('.').reduce<unknown>((current, part) => (current as Record<string, unknown>)?.[part], translations);

  return typeof value === 'string' ? value.replace(/{{(\w+)}}/g, (_match, name) => String(options?.[name] ?? '')) : key;
};

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@/application/integrations/youtube-audio', () => ({
  ...jest.requireActual('@/application/integrations/youtube-audio'),
  getYoutubeAudioMetadata: jest.fn(), downloadYoutubeAudio: jest.fn(),
}));

const metadata: YoutubeAudioMetadata = { videoId: 'lr3hNhA0IfQ', title: 'Meeting Recording', author: 'AppFlowy', duration: 754, thumbnailUrl: 'https://i.ytimg.com/vi/lr3hNhA0IfQ/hqdefault.jpg' };
const youtubeUrl = 'https://youtu.be/lr3hNhA0IfQ?si=share';
const mockMetadata = jest.mocked(getYoutubeAudioMetadata);
const mockDownload = jest.mocked(downloadYoutubeAudio);

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: jest.fn().mockResolvedValue('') } });
  mockMetadata.mockResolvedValue(metadata);
});
afterEach(cleanup);

function renderDialog(props: Partial<React.ComponentProps<typeof AIMeetingUrlDialog>> = {}) {
  const onClose = jest.fn();
  const onConfirm = jest.fn();
  const result = render(<AIMeetingUrlDialog workspaceId='workspace' onClose={onClose} onConfirm={onConfirm} {...props} />);

  return { ...result, onClose, onConfirm };
}

async function pasteYoutube() {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: youtubeUrl } });
  await screen.findByText('Meeting Recording');
}

describe('Flutter YouTube import dialog', () => {
  it('reads the clipboard once on the welcome button click and prefills its YouTube link', async () => {
    const readText = jest.fn().mockResolvedValue(youtubeUrl);

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
    const state = {
      workspaceId: 'workspace', available: true, busy: false, quotaExceeded: false,
      reportError: jest.fn(), importSource: jest.fn(), dismissError: jest.fn(),
    } as unknown as AIMeetingImportState;

    render(<AIMeetingImportActions state={state} showWelcome />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste YouTube URL' }));
    expect(readText).toHaveBeenCalledTimes(1);
    await screen.findByText('Meeting Recording');
    expect(screen.getByRole('textbox').value).toBe(youtubeUrl);
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it('prefills any HTTP link without fetching metadata for an unsupported site', async () => {
    renderDialog({ clipboardText: Promise.resolve('https://example.com/page') });
    await waitFor(() => expect(screen.getByRole('textbox').value).toBe('https://example.com/page'));
    expect(mockMetadata).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Transcribe' }).disabled).toBe(true);
  });

  it('prefills a clipboard YouTube share link, loads its preview, and enables Transcribe', async () => {
    renderDialog({ clipboardText: Promise.resolve(` ${youtubeUrl} `) });
    await screen.findByText('Meeting Recording');
    expect(screen.getByRole('textbox').value).toBe(youtubeUrl);
    expect(screen.getByText('AppFlowy')).toBeTruthy();
    expect(screen.getByText('12:34')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Transcribe' }).disabled).toBe(false);
    expect(mockMetadata).toHaveBeenCalledWith('workspace', youtubeUrl, expect.any(AbortSignal));
  });

  it('keeps Transcribe disabled while loading video information', async () => {
    mockMetadata.mockReturnValue(new Promise(() => undefined));
    renderDialog();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: youtubeUrl } });
    expect((await screen.findByRole('status')).textContent).toContain('Loading video information');
    expect(screen.getByRole('button', { name: 'Transcribe' }).disabled).toBe(true);
  });

  it.each([45, 14401, undefined])('blocks a short, long or unknown video duration (%s)', async (duration) => {
    mockMetadata.mockResolvedValue({ ...metadata, duration });
    renderDialog();
    await pasteYoutube();
    expect(screen.getByRole('alert').textContent).toContain(duration === undefined ? 'Unable to determine' : 'between 1 minute and 4 hours');
    expect(screen.getByRole('button', { name: 'Transcribe' }).disabled).toBe(true);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('shows a metadata error and retries the same link', async () => {
    mockMetadata.mockRejectedValueOnce(new AudioTranscriptionError('youtubeMetadataFailed'));
    renderDialog();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: youtubeUrl } });
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load the YouTube video");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Meeting Recording');
    expect(mockMetadata).toHaveBeenCalledTimes(2);
  });

  it('ignores an old preview after the user changes the link', async () => {
    let complete!: (value: YoutubeAudioMetadata) => void;

    mockMetadata.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    renderDialog();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: youtubeUrl } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com/meeting.mp3' } });
    await act(async () => complete(metadata));
    expect(screen.queryByText('Meeting Recording')).toBeNull();
    expect(screen.getByRole('button', { name: 'Transcribe' }).disabled).toBe(false);
  });

  it('updates download progress, prevents closing, and returns the downloaded file for transcription', async () => {
    let complete!: (file: File) => void;
    let report!: (loaded: number, total?: number) => void;

    mockDownload.mockImplementation((_workspace, _url, _metadata, _signal, onProgress) => {
      report = onProgress;
      return new Promise((resolve) => { complete = resolve; });
    });
    const { onClose, onConfirm } = renderDialog();

    await pasteYoutube();
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe' }));
    act(() => report(256, 1024));
    expect(screen.getByRole('status').textContent).toContain('25%');
    expect(screen.getByRole('progressbar').value).toBe(0.25);
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    act(() => report(768, 1024));
    expect(screen.getByRole('status').textContent).toContain('75%');
    const file = new File(['audio'], 'Meeting Recording.m4a', { type: 'audio/mp4' });

    await act(async () => complete(file));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(file);
  });

  it('stops a download and ignores a late completion without importing it', async () => {
    let complete!: (file: File) => void;
    let signal!: AbortSignal;

    mockDownload.mockImplementation((_workspace, _url, _metadata, active) => {
      signal = active;
      return new Promise((resolve) => { complete = resolve; });
    });
    const { onConfirm } = renderDialog();

    await pasteYoutube();
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(false);
    await act(async () => complete(new File(['audio'], 'meeting.m4a')));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows a download error and retries without closing the dialog', async () => {
    const file = new File(['audio'], 'meeting.m4a');

    mockDownload.mockRejectedValueOnce(new AudioTranscriptionError('youtubeDownloadFailed')).mockResolvedValueOnce(file);
    const { onClose, onConfirm } = renderDialog();

    await pasteYoutube();
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe' }));
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't download the YouTube audio");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(file));
    expect(mockDownload).toHaveBeenCalledTimes(2);
  });

  it('explains a YouTube restriction without importing partial audio and allows retry', async () => {
    const file = new File(['complete audio'], 'meeting.m4a');

    mockDownload.mockRejectedValueOnce(new AudioTranscriptionError('youtubeDownloadBlocked')).mockResolvedValueOnce(file);
    const { onClose, onConfirm } = renderDialog();

    await pasteYoutube();
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe' }));
    expect((await screen.findByRole('alert')).textContent).toContain('YouTube blocked the audio download');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(file));
  });

  it.each(['quotaExceeded', 'recordingTooLong', 'fileTooLarge'] as const)('passes %s to the block’s quota/size handling', async (code) => {
    const failure = new AudioTranscriptionError(code, undefined, 25 * 1024 * 1024);
    const onFailure = jest.fn();

    mockDownload.mockRejectedValueOnce(failure);
    const { onClose } = renderDialog({ onFailure });

    await pasteYoutube();
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe' }));
    await waitFor(() => expect(onFailure).toHaveBeenCalledWith(failure));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('aborts a pending download when the document is closed', async () => {
    let signal!: AbortSignal;

    mockDownload.mockImplementation((_workspace, _url, _metadata, active) => {
      signal = active;
      return new Promise(() => undefined);
    });
    const { unmount } = renderDialog();

    await pasteYoutube();
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe' }));
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('cancels the old workspace download and resets the dialog when switching workspaces', async () => {
    let complete!: (file: File) => void;
    let signal!: AbortSignal;

    mockDownload.mockImplementationOnce((_workspace, _url, _metadata, active) => {
      signal = active;
      return new Promise((resolve) => { complete = resolve; });
    });
    const { rerender, onClose, onConfirm } = renderDialog();

    await pasteYoutube();
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe' }));
    rerender(<AIMeetingUrlDialog workspaceId='another-workspace' onClose={onClose} onConfirm={onConfirm} />);

    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('textbox').value).toBe('');
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(false);
    await act(async () => complete(new File(['audio'], 'old-workspace.m4a')));
    expect(onConfirm).not.toHaveBeenCalled();

    await pasteYoutube();
    expect(mockMetadata).toHaveBeenLastCalledWith('another-workspace', youtubeUrl, expect.any(AbortSignal));
  });

  it('uses the current confirmation handler when a download finishes after rerender', async () => {
    let complete!: (file: File) => void;

    mockDownload.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const { rerender, onClose, onConfirm } = renderDialog();
    const nextConfirm = jest.fn();

    await pasteYoutube();
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe' }));
    rerender(<AIMeetingUrlDialog workspaceId='workspace' onClose={onClose} onConfirm={nextConfirm} />);
    const file = new File(['audio'], 'meeting.m4a');

    await act(async () => complete(file));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(nextConfirm).toHaveBeenCalledWith(file);
    expect(mockDownload).toHaveBeenCalledTimes(1);
  });
});
