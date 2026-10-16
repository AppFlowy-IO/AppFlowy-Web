import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Node } from 'slate';

import translations from '@/@types/translations/en.json';
import { AIMeetingBlockData, BlockType } from '@/application/types';
import { AIMeetingNode } from '@/components/editor/editor.type';

import { AIMeetingBlock } from '../AIMeetingBlock';
import { AIMeetingImportState } from '../useAIMeetingImport';

const mockT = (key: string, options?: Record<string, unknown>) => {
  const value = key.split('.').reduce<unknown>((current, part) => (current as Record<string, unknown>)?.[part], translations);

  return typeof value === 'string' ? value : options?.defaultValue ?? key;
};

let mockReadOnly = false;
let mockRegeneratingSummary = false;
let mockPreprocessingSpeakers = false;
let mockSummaryError: string | undefined;
let mockWorkspaceId = 'workspace';
let mockImporter: AIMeetingImportState;
let mockImportOptions: { onFinished: () => void };
const mockGenerateSummary = jest.fn();
const mockCancelSummary = jest.fn();
const mockTranscriptReady = jest.fn();
const mockCloseRegenerateMenu = jest.fn();
const mockDismissSummaryError = jest.fn();
const mockSetBlockData = jest.fn();
const mockRecording = jest.fn(() => null);

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('slate-react', () => ({
  useReadOnly: () => mockReadOnly,
  useSlateStatic: () => ({ isElementReadOnly: () => false }),
}));
jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: {
    getBlockTextContent: (node: Node) => Node.string(node),
    setBlockData: (...args: unknown[]) => mockSetBlockData(...args),
  },
}));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ workspaceId: mockWorkspaceId, viewId: 'view' }),
}));
jest.mock('../useAIMeetingImport', () => ({
  useAIMeetingImport: (options: { onFinished: () => void }) => {
    mockImportOptions = options;
    return mockImporter;
  },
}));
jest.mock('../useAIMeetingRegenerate', () => ({
  SUMMARY_LANGUAGE_OPTIONS: [],
  useAIMeetingRegenerate: () => ({ isAIEnabled: true, isRegeneratingSummary: mockRegeneratingSummary, isPreprocessingSpeakers: mockPreprocessingSpeakers, summaryError: mockSummaryError, dismissSummaryError: mockDismissSummaryError, handleRegenerateSummary: mockGenerateSummary, handleCancelSummary: mockCancelSummary, handleTranscriptReady: mockTranscriptReady, handleRegenerateMenuClose: mockCloseRegenerateMenu }),
}));
jest.mock('../AIMeetingRecording', () => ({ AIMeetingRecording: (props: unknown) => mockRecording(props) }));
jest.mock('../useAIMeetingClipboard', () => ({ useAIMeetingClipboard: () => ({ handleCopy: jest.fn() }) }));
jest.mock('../AIMeetingMoreMenu', () => ({ AIMeetingMoreMenu: () => null }));
jest.mock('../RegenerateMenu', () => ({
  RegenerateMenu: ({ action, isRegenerating, onRegenerate }: { action: string; isRegenerating: boolean; onRegenerate: () => void }) => (
    <button disabled={isRegenerating} onClick={onRegenerate}>{isRegenerating ? 'Generating' : action === 'generate' ? 'Generate summary' : 'Regenerate'}</button>
  ),
}));

function meeting(data: AIMeetingBlockData = {}, texts: [string, string, string] = ['', '', '']) {
  return {
    blockId: 'meeting',
    type: BlockType.AIMeetingBlock,
    data,
    children: [BlockType.AIMeetingSummaryBlock, BlockType.AIMeetingNotesBlock, BlockType.AIMeetingTranscriptionBlock].map((type, index) => ({
      blockId: `section-${index}`, type, data: {}, children: [{ text: texts[index] }],
    })),
  } as unknown as AIMeetingNode;
}

function renderBlock(node = meeting()) {
  return render(<MemoryRouter><AIMeetingBlock node={node}><div>Section contents</div></AIMeetingBlock></MemoryRouter>);
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockReadOnly = false;
  mockRegeneratingSummary = false;
  mockPreprocessingSpeakers = false;
  mockSummaryError = undefined;
  mockWorkspaceId = 'workspace';
  mockImporter = {
    workspaceId: 'workspace', reportError: jest.fn(), available: true, busy: false, stage: 'idle', progress: undefined, error: undefined, errorCode: undefined,
    message: '', usage: undefined, quotaExceeded: false, errorDismissed: false, showPromotion: false, dismissPromotion: jest.fn(),
    dismissError: jest.fn(), canRetry: false, retry: jest.fn(async () => undefined), importSource: jest.fn(async () => undefined), importCaptions: jest.fn(),
    cancel: jest.fn(async () => undefined), language: 'en', setLanguage: jest.fn(),
  };
});
afterEach(cleanup);

describe('Flutter transcript block integration', () => {
  it('shows the language support banner on the first insertion and remembers dismissal per workspace', () => {
    const first = renderBlock();

    expect(screen.getByText(translations.document.aiMeeting.import.languageSupportMessage)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss language support message' }));
    expect(screen.queryByText(translations.document.aiMeeting.import.languageSupportMessage)).toBeNull();
    expect(localStorage.getItem('hasClickedAIMeetingBanner_workspace')).toBe('true');
    first.unmount();

    const second = renderBlock();

    expect(screen.queryByText(translations.document.aiMeeting.import.languageSupportMessage)).toBeNull();
    second.unmount();
    mockWorkspaceId = 'other-workspace';
    renderBlock();
    expect(screen.getByText(translations.document.aiMeeting.import.languageSupportMessage)).toBeTruthy();
  });

  it('shows the language support banner in Transcript and hides it in Summary and Notes', () => {
    renderBlock(meeting({}, ['Summary text', 'Notes text', 'Transcript text']));
    const message = translations.document.aiMeeting.import.languageSupportMessage;

    expect(screen.queryByText(message)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(screen.getByText(message)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(screen.queryByText(message)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss language support message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(screen.queryByText(message)).toBeNull();
  });

  it('dismisses the language banner in other open blocks in the same workspace', () => {
    renderBlock();
    renderBlock();
    expect(screen.getAllByText(translations.document.aiMeeting.import.languageSupportMessage)).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss language support message' })[0]);
    expect(screen.queryByText(translations.document.aiMeeting.import.languageSupportMessage)).toBeNull();
  });

  it('keeps the language banner dismissible when local browser storage is blocked', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });

    try {
      renderBlock();
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss language support message' }));
      expect(screen.queryByText(translations.document.aiMeeting.import.languageSupportMessage)).toBeNull();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it('renders the two import actions and hides live meeting creation', () => {
    renderBlock();
    expect(screen.getByRole('button', { name: 'Transcribe audio file' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Paste YouTube URL' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start transcribing' })).toBeNull();
    expect(screen.getByPlaceholderText('AI transcript')).toBeTruthy();
    expect(mockRecording).toHaveBeenCalledWith(expect.objectContaining({ hideStartButton: true }));
  });

  it('persists a custom title on Enter and keeps an empty title as the placeholder', () => {
    renderBlock();
    const input = screen.getByPlaceholderText('AI transcript');

    fireEvent.change(input, { target: { value: '  Project review  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockSetBlockData).toHaveBeenCalledWith(expect.anything(), 'meeting', { title: 'Project review' });
  });

  it('keeps locked pages readable with disabled import and title editing', () => {
    mockReadOnly = true;
    mockImporter.available = false;
    renderBlock();
    expect(screen.getByRole('textbox').disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Transcribe audio file' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Paste YouTube URL' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Dismiss language support message' }).disabled).toBe(false);
    expect(mockRecording).not.toHaveBeenCalled();
  });

  it('shows the active Transcript tab, language, progress and Cancel for a submitted import', async () => {
    mockImporter.busy = true;
    mockImporter.stage = 'analyzing';
    const { container } = renderBlock(meeting({ transcript_id: 'job', transcription_type: 'audioFile', selected_tab_index: 1 }));

    await waitFor(() => expect(container.querySelector('[data-ai-meeting-active="transcript"]')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe('Processing your file');
    expect(screen.getByText(translations.document.aiMeeting.import.languageSupportMessage)).toBeTruthy();
    expect(screen.getByRole('combobox').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Transcribe audio file' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockImporter.cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps a recoverable job visible and offers Retry after a network error', async () => {
    mockImporter.error = new Error('Offline');
    mockImporter.message = 'Unable to retrieve the transcript.';
    mockImporter.canRetry = true;
    const { container } = renderBlock(meeting({ transcript_id: 'job', transcription_type: 'audioFile', selected_tab_index: 1 }));

    await waitFor(() => expect(container.querySelector('[data-ai-meeting-active="transcript"]')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Unable to retrieve the transcript.');
    expect(screen.queryByRole('button', { name: 'Dismiss transcription error' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockImporter.retry).toHaveBeenCalledTimes(1);
  });

  it('retains the Pro promotion on Summary, Notes, and Transcript tabs', () => {
    mockImporter.quotaExceeded = true;
    mockImporter.showPromotion = true;
    mockImporter.message = 'This workspace has reached its free transcription limit.';
    renderBlock(meeting({}, ['Summary text', 'Notes text', 'Transcript text']));

    ['Summary', 'Notes', 'Transcript'].forEach((tab) => {
      fireEvent.click(screen.getByRole('button', { name: tab }));
      expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss upgrade promotion' }));
    expect(mockImporter.dismissPromotion).toHaveBeenCalledTimes(1);
  });

  it('provides a working dismiss control for quota errors while keeping exhausted imports blocked', () => {
    mockImporter.quotaExceeded = true;
    mockImporter.message = 'This workspace has reached its free transcription limit.';
    const node = meeting();
    const { rerender } = renderBlock(node);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss transcription error' }));
    expect(mockImporter.dismissError).toHaveBeenCalledTimes(1);
    mockImporter.errorDismissed = true;
    rerender(<MemoryRouter><AIMeetingBlock node={node}><div>Section contents</div></AIMeetingBlock></MemoryRouter>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Transcribe audio file' }).disabled).toBe(true);
  });

  it.each([
    ['none', 'idle', false], ['realtime', 'idle', false], ['realtime', 'recording', true], ['audioFile', 'recorded', true], ['urlSource', 'recorded', true],
  ] as const)('keeps Flutter language-editing rules for %s in %s', async (type, recording, disabled) => {
    renderBlock(meeting({ transcription_type: type, recording_state: recording, selected_tab_index: 2 }, ['', '', 'Transcript text']));
    await waitFor(() => expect(screen.getByRole('combobox').disabled).toBe(disabled));
  });

  it('preprocesses every completed import, including blocks with an existing summary', () => {
    const empty = renderBlock();

    mockImportOptions.onFinished();
    expect(mockTranscriptReady).toHaveBeenCalledTimes(1);
    empty.unmount();
    renderBlock(meeting({}, ['Existing summary', '', 'Transcript text']));
    mockImportOptions.onFinished();
    expect(mockTranscriptReady).toHaveBeenCalledTimes(2);
    expect(mockGenerateSummary).not.toHaveBeenCalled();
  });

  it('keeps an empty Summary tab and its loading indicator visible after transcription finishes', () => {
    mockRegeneratingSummary = true;
    const { container } = renderBlock(meeting({ selected_tab_index: 0 }, ['', '', 'New transcript']));

    expect(container.querySelector('[data-ai-meeting-active="summary"][aria-busy="true"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Summary' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Generating AI summary');
    expect(screen.queryByRole('button', { name: 'Transcribe audio file' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    expect(screen.getByRole('status').textContent).toBe('Generating AI summary');
  });

  it('aligns Generate with the title and keeps Summary available for a completed transcript', () => {
    const { container, rerender } = renderBlock(meeting({}, ['', '', 'Ready transcript']));
    const generate = screen.getByRole('button', { name: 'Generate summary' });
    const titleRow = screen.getByRole('textbox').parentElement!;

    expect(titleRow.contains(generate)).toBe(true);
    expect(container.querySelector('.ai-meeting-tabs')?.contains(generate)).toBe(false);
    expect(screen.getByRole('button', { name: 'Summary' })).toBeTruthy();
    fireEvent.click(generate);
    expect(mockGenerateSummary).toHaveBeenCalledTimes(1);

    rerender(<MemoryRouter><AIMeetingBlock node={meeting({ selected_tab_index: 0 }, ['Generated summary', '', 'Ready transcript'])}><div>Section contents</div></AIMeetingBlock></MemoryRouter>);
    expect(container.querySelector('[data-ai-meeting-active="summary"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generate summary' })).toBeNull();
    expect(container.querySelector('.ai-meeting-tabs')?.contains(screen.getByRole('button', { name: 'Regenerate' }))).toBe(true);
  });

  it('keeps Summary selected after a generation error and offers Retry and dismiss', () => {
    mockRegeneratingSummary = true;
    const node = meeting({ selected_tab_index: 0 }, ['', '', 'Ready transcript']);
    const { container, rerender } = renderBlock(node);

    mockRegeneratingSummary = false;
    mockSummaryError = 'Failed to regenerate summary';
    rerender(<MemoryRouter><AIMeetingBlock node={node}><div>Section contents</div></AIMeetingBlock></MemoryRouter>);
    expect(container.querySelector('[data-ai-meeting-active="summary"]')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(mockSummaryError);
    expect(screen.getByRole('button', { name: 'Generate summary' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockGenerateSummary).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss summary error' }));
    expect(mockDismissSummaryError).toHaveBeenCalledTimes(1);
  });

  it('shows the processing indicator while speakers are being inferred before summary generation', () => {
    mockRegeneratingSummary = true;
    mockPreprocessingSpeakers = true;
    const { container } = renderBlock(meeting({ selected_tab_index: 0 }, ['', '', 'New transcript']));

    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Processing your file');
  });

  it('keeps existing summary content visible while regenerating it', () => {
    mockRegeneratingSummary = true;
    const { container } = renderBlock(meeting({ selected_tab_index: 0 }, ['Existing summary', '', 'Transcript']));

    expect(screen.getByRole('status').textContent).toBe('Generating AI summary');
    expect(container.querySelector('.ai-meeting-content')?.classList.contains('hidden')).toBe(false);
  });

  it('puts the blue, enabled summary Cancel button beside the title and keeps it available on every tab', () => {
    mockRegeneratingSummary = true;
    const { container } = renderBlock(meeting({ selected_tab_index: 0 }, ['Previous summary', '', 'Transcript']));
    const cancel = screen.getByRole('button', { name: 'Cancel' });

    expect(screen.getByRole('textbox').parentElement?.contains(cancel)).toBe(true);
    expect(container.querySelector('.ai-meeting-tabs')?.contains(cancel)).toBe(false);
    expect(cancel.classList.contains('bg-fill-theme-thick')).toBe(true);
    expect(cancel.classList.contains('rounded-full')).toBe(true);
    expect(cancel.disabled).toBe(false);
    expect(cancel.querySelector('svg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generating' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBe(cancel);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBe(cancel);
    fireEvent.click(cancel);
    expect(mockCancelSummary).toHaveBeenCalledTimes(1);
    expect(mockImporter.cancel).not.toHaveBeenCalled();
  });
});
