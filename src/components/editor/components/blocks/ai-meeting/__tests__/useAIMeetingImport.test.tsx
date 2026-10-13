import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { initializeMeetingSections } from '../ai-meeting.import';
import { useAIMeetingImport } from '../useAIMeetingImport';
import { AudioTranscriptionError, readMediaDuration } from '@/application/integrations/transcription-media';
import * as api from '@/application/services/js-services/http/meeting-api';
import { YjsEditor } from '@/application/slate-yjs';
import { traverseBlock } from '@/application/slate-yjs/utils/convert';
import { createBlock, dataStringTOJson, getBlock, getChildrenArray, initializeDocumentStructure, updateBlockParent } from '@/application/slate-yjs/utils/yjs';
import { AIMeetingBlockData, BlockType, SubscriptionInterval, SubscriptionPlan, WorkspaceUsageAndLimit, YjsEditorKey, YSharedRoot } from '@/application/types';
import translations from '@/@types/translations/en.json';

const mockT = (key: string) => {
  const value = key.split('.').reduce<unknown>((current, part) => (current as Record<string, unknown>)?.[part], translations);

  return typeof value === 'string' ? value : key;
};

let mockEditor: YjsEditor;
let mockWorkspaceId: string;
let mockHosted: boolean;
const mockSubscriptions = jest.fn();
const mocked = jest.mocked(api);
let sequence = 0;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('slate-react', () => ({ useSlateStatic: () => mockEditor }));
jest.mock('@/components/editor/EditorContext', () => ({ useEditorContext: () => ({ workspaceId: mockWorkspaceId, getSubscriptions: mockSubscriptions }) }));
jest.mock('@/components/app/hooks/useServerInfo', () => ({
  useIsOfficialHosted: () => mockHosted,
  useServerHostingMode: () => mockHosted ? 'cloud' : 'self-hosted',
  useServerInfoState: () => ({ status: 'available' }),
}));
jest.mock('@/application/services/js-services/http/meeting-api', () => ({
  getMeetingUsage: jest.fn(), uploadMeetingAudio: jest.fn(), submitMeetingTranscript: jest.fn(),
  getMeetingTranscript: jest.fn(), getMeetingParagraphs: jest.fn(), deleteMeetingTranscript: jest.fn(),
}));
jest.mock('@/application/integrations/transcription-media', () => ({
  ...jest.requireActual('@/application/integrations/transcription-media'), readMediaDuration: jest.fn(),
}));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const usage = (used = 0) => ({ ai_transcription_seconds: used, ai_transcription_seconds_limit: 1000, single_upload_limit: 25 * 1024 * 1024 } as WorkspaceUsageAndLimit);
const file = () => new File(['recording'], 'Weekly_sync_123.mp4');
const subscriptions = (plan: SubscriptionPlan) => [{ plan, price_cents: 0, currency: 'USD', recurring_interval: SubscriptionInterval.Month }];

function fixture(data: AIMeetingBlockData = {}, initialOptions = {}) {
  const doc = new Y.Doc();

  initializeDocumentStructure(doc, false, 'document');
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const meeting = createBlock(sharedRoot, { ty: BlockType.AIMeetingBlock, data });

  updateBlockParent(sharedRoot, meeting, getBlock(sharedRoot.get(YjsEditorKey.document).get(YjsEditorKey.page_id), sharedRoot), 0);
  mockEditor = { sharedRoot } as YjsEditor;
  const blockId = meeting.get(YjsEditorKey.block_id);

  initializeMeetingSections(mockEditor, blockId);
  const transcriptBlockId = getChildrenArray(meeting.get(YjsEditorKey.block_children), sharedRoot).toArray()[2];
  const onFinished = jest.fn();
  const props = { readOnly: false, enabled: true, hasTranscript: false, ...initialOptions };
  const hook = renderHook((options = props) => useAIMeetingImport({
    blockId, data: dataStringTOJson(meeting.get(YjsEditorKey.block_data)), transcriptBlockId, onFinished, ...options,
  }), { initialProps: props });

  return { ...hook, onFinished, meeting, transcriptBlockId, readData: () => dataStringTOJson(meeting.get(YjsEditorKey.block_data)) as AIMeetingBlockData };
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.values(mocked).forEach((mock) => { if (jest.isMockFunction(mock)) mock.mockReset(); });
  mockSubscriptions.mockReset();
  jest.mocked(readMediaDuration).mockReset();
  localStorage.clear();
  mockWorkspaceId = `workspace-${++sequence}`;
  mockHosted = true;
  mockSubscriptions.mockResolvedValue([]);
  mocked.getMeetingUsage.mockResolvedValue(usage());
  mocked.uploadMeetingAudio.mockResolvedValue('https://cdn.example.com/file');
  mocked.submitMeetingTranscript.mockResolvedValue({ id: 'job', status: 'queued' });
  mocked.getMeetingTranscript.mockResolvedValue({ id: 'job', status: 'completed', text: 'Transcript text' });
  mocked.getMeetingParagraphs.mockResolvedValue({ paragraphs: [] });
  mocked.deleteMeetingTranscript.mockResolvedValue(undefined);
  jest.mocked(readMediaDuration).mockResolvedValue(90);
});
afterEach(cleanup);

describe('Flutter import state and editor integration', () => {
  it('initializes an editable empty block with automatic language and available actions', async () => {
    const { result } = fixture();

    await waitFor(() => expect(result.current.usage).toEqual(usage()));
    expect(result.current).toMatchObject({ stage: 'idle', available: true, language: 'auto', quotaExceeded: false });
  });

  it('updates the default file title, persists transcript content, and generates a summary after completion', async () => {
    const { result, readData, transcriptBlockId, onFinished } = fixture();

    await act(async () => { await result.current.importSource(file()); });
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(readData()).toMatchObject({ title: 'Weekly_sync', transcription_type: 'audioFile', transcript_id: 'job', audio_file_path: '', recording_state: 'recorded', selected_tab_index: 1 });
    expect(JSON.stringify(traverseBlock(transcriptBlockId, mockEditor.sharedRoot))).toContain('Transcript text');
    expect(result.current.stage).toBe('idle');
  });

  it('preserves custom titles', async () => {
    const { result, readData } = fixture({ title: 'Custom meeting title' });

    await act(async () => { await result.current.importSource(file()); });
    expect(readData().title).toBe('Custom meeting title');
  });

  it('persists a URL source type and avoids file upload', async () => {
    const { result, readData } = fixture();

    await act(async () => { await result.current.importSource({ url: 'https://example.com/meeting.mp3' }); });
    expect(readData().transcription_type).toBe('urlSource');
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
  });

  it('shows a retryable upload error and clears it after successful retry', async () => {
    mocked.uploadMeetingAudio.mockRejectedValueOnce(new Error('Offline'));
    const { result } = fixture();

    await act(async () => { await result.current.importSource(file()); });
    expect(result.current).toMatchObject({ errorCode: 'uploadFailed', busy: false, canRetry: true });
    expect(result.current.message).toBe('Unable to upload the audio file.');
    await act(async () => { await result.current.retry(); });
    expect(result.current.error).toBeUndefined();
    expect(mocked.uploadMeetingAudio).toHaveBeenCalledTimes(2);
  });

  it('clears an initial usage error after the connection recovers', async () => {
    mocked.getMeetingUsage.mockRejectedValueOnce(new Error('Offline'));
    const { result } = fixture();

    await waitFor(() => expect(result.current.errorCode).toBe('usageFailed'));
    expect(result.current.canRetry).toBe(true);
    await act(async () => { await result.current.retry(); });
    expect(result.current.error).toBeUndefined();
    expect(result.current.usage).toEqual(usage());
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
  });

  it('restores the source actions when a recording contains no speech', async () => {
    mocked.getMeetingTranscript.mockResolvedValueOnce({ id: 'job', status: 'completed', text: '' });
    const { result, readData } = fixture();

    await act(async () => { await result.current.importSource(file()); });
    expect(result.current.errorCode).toBe('noTranscript');
    expect(readData()).toMatchObject({ transcript_id: '', recording_state: 'idle' });
    await act(async () => { await result.current.importSource(new File(['replacement'], 'replacement.wav')); });
    expect(result.current.error).toBeUndefined();
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledTimes(2);
  });

  it('recovers the submitted job on retry without uploading or submitting twice', async () => {
    mocked.getMeetingTranscript.mockRejectedValueOnce(new Error('Offline'));
    const { result, readData } = fixture();

    await act(async () => { await result.current.importSource(file()); });
    expect(readData().transcript_id).toBe('job');
    expect(result.current.errorCode).toBe('resultFailed');
    await act(async () => { await result.current.retry(); });
    expect(mocked.uploadMeetingAudio).toHaveBeenCalledTimes(1);
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledTimes(1);
  });

  it('restores an existing job on page reopening without importing source audio', async () => {
    const { onFinished } = fixture({ transcript_id: 'job', transcription_type: 'audioFile' });

    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(mocked.getMeetingTranscript).toHaveBeenCalledTimes(1);
    expect(mocked.submitMeetingTranscript).not.toHaveBeenCalled();
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
  });

  it('does not refetch completed transcripts on page reopening', async () => {
    const { result } = fixture({ transcript_id: 'job', transcription_type: 'audioFile' }, { hasTranscript: true });

    await waitFor(() => expect(result.current.stage).toBe('idle'));
    expect(mocked.getMeetingTranscript).not.toHaveBeenCalled();
  });

  it.each([{ readOnly: true, enabled: true }, { readOnly: false, enabled: false }])('does not import on locked or AI-disabled pages (%j)', async (options) => {
    const { result, rerender } = fixture();

    rerender({ ...options, hasTranscript: false });
    await act(async () => { await result.current.importSource(file()); });
    expect(result.current.available).toBe(false);
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
  });

  it('ignores late upload results if editing permission is removed', async () => {
    let complete!: (response: string) => void;

    mocked.uploadMeetingAudio.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const { result, rerender, onFinished } = fixture();
    let pending!: Promise<void>;

    act(() => { pending = result.current.importSource(file()); });
    await waitFor(() => expect(mocked.uploadMeetingAudio).toHaveBeenCalledTimes(1));
    rerender({ readOnly: true, enabled: true, hasTranscript: false });
    await act(async () => { complete('https://cdn.example.com/late'); await pending; });
    expect(mocked.submitMeetingTranscript).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('blocks double clicks synchronously', async () => {
    const { result } = fixture();

    await act(async () => { await Promise.all([result.current.importSource(file()), result.current.importSource(file())]); });
    expect(mocked.uploadMeetingAudio).toHaveBeenCalledTimes(1);
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledTimes(1);
  });

  it.each(['workspace', 'editor'] as const)('resets a pending import when the %s changes and ignores its late result', async (scope) => {
    let complete!: (response: string) => void;

    mocked.uploadMeetingAudio.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const { result, rerender, onFinished } = fixture();
    let pending!: Promise<void>;

    act(() => { pending = result.current.importSource(file()); });
    await waitFor(() => expect(mocked.uploadMeetingAudio).toHaveBeenCalledTimes(1));
    const signal = mocked.uploadMeetingAudio.mock.calls[0][2]!;

    if (scope === 'workspace') mockWorkspaceId = `workspace-${++sequence}`;
    else mockEditor = { ...mockEditor } as YjsEditor;
    rerender({ readOnly: false, enabled: true, hasTranscript: false });

    expect(signal.aborted).toBe(true);
    expect(result.current).toMatchObject({ busy: false, stage: 'idle', progress: undefined });
    await act(async () => { complete('https://cdn.example.com/late'); await pending; });
    expect(onFinished).not.toHaveBeenCalled();
    expect(mocked.submitMeetingTranscript).not.toHaveBeenCalled();

    await act(async () => { await result.current.importSource(file()); });
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledWith(mockWorkspaceId, expect.anything(), 90, expect.any(AbortSignal));
  });

  it('clears the previous workspace quota and error while checking a different workspace', async () => {
    mocked.getMeetingUsage.mockResolvedValueOnce(usage(1000));
    const { result, rerender } = fixture();

    await waitFor(() => expect(result.current.quotaExceeded).toBe(true));
    act(() => { result.current.reportError(new AudioTranscriptionError('quotaExceeded')); });
    mocked.getMeetingUsage.mockReturnValueOnce(new Promise(() => undefined));
    mockWorkspaceId = `workspace-${++sequence}`;
    rerender({ readOnly: false, enabled: true, hasTranscript: false });

    expect(result.current).toMatchObject({ usage: undefined, quotaExceeded: false, error: undefined, showPromotion: false });
    expect(mocked.getMeetingUsage).toHaveBeenLastCalledWith(mockWorkspaceId, expect.any(AbortSignal));
  });

  it('can dismiss non-quota errors', async () => {
    mocked.uploadMeetingAudio.mockRejectedValueOnce(new Error('Offline'));
    const { result } = fixture();

    await act(async () => { await result.current.importSource(file()); });
    act(() => { result.current.dismissError(); });
    expect(result.current.error).toBeUndefined();
  });

  it('loads a workspace default, preserves a saved node language, and reloads when workspace changes', async () => {
    localStorage.setItem(`ai-meeting-transcript-language:${mockWorkspaceId}`, 'fr');
    const { result, rerender } = fixture();

    expect(result.current.language).toBe('fr');
    act(() => { result.current.setLanguage('de'); });
    expect(localStorage.getItem(`ai-meeting-transcript-language:${mockWorkspaceId}`)).toBe('de');
    mockWorkspaceId = `workspace-${++sequence}`;
    localStorage.setItem(`ai-meeting-transcript-language:${mockWorkspaceId}`, 'es');
    rerender({ readOnly: false, enabled: true, hasTranscript: false });
    expect(result.current.language).toBe('de');
  });

  it('reloads the default language when switching workspaces on a new block', () => {
    localStorage.setItem(`ai-meeting-transcript-language:${mockWorkspaceId}`, 'fr');
    const { result, rerender } = fixture();

    expect(result.current.language).toBe('fr');
    mockWorkspaceId = `workspace-${++sequence}`;
    localStorage.setItem(`ai-meeting-transcript-language:${mockWorkspaceId}`, 'es');
    rerender({ readOnly: false, enabled: true, hasTranscript: false });
    expect(result.current.language).toBe('es');
  });
});

describe('Flutter quota messages and promotion eligibility', () => {
  it('blocks a Free workspace at its limit and offers a dismissible Pro promotion', async () => {
    mocked.getMeetingUsage.mockResolvedValue(usage(1000));
    const { result } = fixture();

    await waitFor(() => expect(result.current.showPromotion).toBe(true));
    expect(result.current.quotaExceeded).toBe(true);
    expect(result.current.canRetry).toBe(false);
    expect(result.current.message).toContain('Upgrade to Pro');
    act(() => { result.current.dismissPromotion(); });
    expect(result.current.showPromotion).toBe(false);
    expect(result.current.quotaExceeded).toBe(true);
    await act(async () => { await result.current.importSource(file()); });
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
  });

  it('lets a shorter recording replace one that exceeds the remaining allowance after dismissal', async () => {
    jest.mocked(readMediaDuration).mockResolvedValue(1001);
    const { result } = fixture();

    await act(async () => { await result.current.importSource(file()); });
    expect(result.current.errorCode).toBe('recordingTooLong');
    expect(result.current.quotaExceeded).toBe(false);
    expect(result.current.message).toContain('Please upgrade to Pro to unlock more transcript minutes. Or upload a shorter recording.');
    expect(result.current.canRetry).toBe(false);
    const callsBeforeRetry = mocked.getMeetingUsage.mock.calls.length;

    await act(async () => { await result.current.retry(); });
    expect(mocked.getMeetingUsage).toHaveBeenCalledTimes(callsBeforeRetry);
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
    act(() => { result.current.dismissError(); });
    expect(result.current.error).toBeUndefined();
    expect(result.current.errorDismissed).toBe(true);
    expect(result.current.canRetry).toBe(false);
    jest.mocked(readMediaDuration).mockResolvedValue(90);
    const shorter = new File(['shorter'], 'shorter.mp4');

    await act(async () => { await result.current.importSource(shorter); });
    expect(mocked.uploadMeetingAudio).toHaveBeenCalledWith(mockWorkspaceId, shorter, expect.any(AbortSignal), expect.any(Function));
    expect(mocked.submitMeetingTranscript).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeUndefined();
  });

  it('allows dismissing a quota banner without resetting or bypassing exhausted usage', async () => {
    mocked.getMeetingUsage.mockResolvedValue(usage(1000));
    const { result } = fixture();

    await waitFor(() => expect(result.current.quotaExceeded).toBe(true));
    await act(async () => { result.current.dismissError(); });
    expect(result.current.errorDismissed).toBe(true);
    expect(result.current.quotaExceeded).toBe(true);
    expect(result.current.canRetry).toBe(false);
    expect(result.current.usage).toEqual(usage(1000));
    await act(async () => { await result.current.importSource(file()); });
    expect(result.current.errorDismissed).toBe(false);
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
    expect(mocked.submitMeetingTranscript).not.toHaveBeenCalled();
  });

  it('rechecks an earlier quota rejection on dismissal and restores import when minutes remain', async () => {
    const { result } = fixture();

    await waitFor(() => expect(result.current.usage).toEqual(usage()));
    act(() => { result.current.reportError(new AudioTranscriptionError('quotaExceeded')); });
    expect(result.current.quotaExceeded).toBe(true);
    await act(async () => { result.current.dismissError(); });
    expect(result.current.quotaExceeded).toBe(false);
    expect(result.current.errorDismissed).toBe(true);
    expect(mocked.getMeetingUsage).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.importSource(file()); });
    expect(mocked.uploadMeetingAudio).toHaveBeenCalledTimes(1);
  });

  it('keeps a YouTube duration rejection separate from exhausted quota and accepts a replacement file', async () => {
    const { result } = fixture();

    await waitFor(() => expect(result.current.usage).toEqual(usage()));
    act(() => { result.current.reportError(new AudioTranscriptionError('recordingTooLong')); });
    expect(result.current.quotaExceeded).toBe(false);
    expect(result.current.canRetry).toBe(false);
    act(() => { result.current.dismissError(); });
    await act(async () => { await result.current.importSource(file()); });
    expect(mocked.uploadMeetingAudio).toHaveBeenCalledTimes(1);
  });

  it('does not offer Retry for a YouTube quota failure before a file transcription session exists', async () => {
    const { result } = fixture();

    await waitFor(() => expect(result.current.usage).toEqual(usage()));
    act(() => { result.current.reportError(new AudioTranscriptionError('quotaExceeded')); });
    expect(result.current.canRetry).toBe(false);
    await act(async () => { await result.current.retry(); });
    expect(mocked.getMeetingUsage).toHaveBeenCalledTimes(1);
    expect(mocked.uploadMeetingAudio).not.toHaveBeenCalled();
  });

  it.each([SubscriptionPlan.Pro, SubscriptionPlan.Team, SubscriptionPlan.AIMax])('preserves server reset guidance for %s without a Pro promotion', async (plan) => {
    mockSubscriptions.mockResolvedValue(subscriptions(plan));
    mocked.submitMeetingTranscript.mockRejectedValue({
      code: 1129,
      message: 'Internal quota diagnostic',
      user_error: {
        schema_version: 1,
        reason: 'TRANSCRIPTION_LIMIT_REACHED',
        locale: 'en',
        message: 'Allowance resets on November 1',
      },
    });
    const { result } = fixture();

    await act(async () => { await result.current.importSource({ url: 'https://example.com/meeting.mp3' }); });
    await waitFor(() => expect(mockSubscriptions).toHaveBeenCalled());
    expect(result.current.message).toBe('Allowance resets on November 1');
    expect(result.current.showPromotion).toBe(false);
  });

  it('uses administrator guidance on self-hosted servers', async () => {
    mockHosted = false;
    mocked.getMeetingUsage.mockResolvedValue(usage(1000));
    const { result } = fixture();

    await waitFor(() => expect(result.current.quotaExceeded).toBe(true));
    expect(result.current.message).toContain('Contact your administrator');
    expect(result.current.showPromotion).toBe(false);
    expect(mockSubscriptions).not.toHaveBeenCalled();
  });

  it('does not advertise billing when subscription details are unavailable', async () => {
    mockSubscriptions.mockResolvedValue(undefined);
    mocked.getMeetingUsage.mockResolvedValue(usage(1000));
    const { result } = fixture();

    await waitFor(() => expect(result.current.quotaExceeded).toBe(true));
    expect(result.current.showPromotion).toBe(false);
  });
});
