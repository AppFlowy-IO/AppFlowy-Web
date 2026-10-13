import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { Element, Node } from 'slate';
import * as Y from 'yjs';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { traverseBlock } from '@/application/slate-yjs/utils/convert';
import { createBlock, dataStringTOJson, deleteBlock, getBlock, getChildrenArray, initializeDocumentStructure, updateBlockParent } from '@/application/slate-yjs/utils/yjs';
import { AIMeetingBlockData, BlockType, YjsEditorKey, YSharedRoot } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { AIMeetingNode } from '@/components/editor/editor.type';

import { applyAudioTranscript, initializeMeetingSections, updateMeetingData } from '../ai-meeting.import';
import { fetchSummaryRegenerateTemplateConfig, replaceBlockChildrenWithMarkdown } from '../ai-meeting.summary-regenerate';
import { useAIMeetingRegenerate } from '../useAIMeetingRegenerate';

let mockEditor: YjsEditor;
let mockReadOnly = false;
let mockAIEnabled = true;
let mockWorkspaceId = 'workspace';
const mockFetch = jest.fn();
const docs: Y.Doc[] = [];
const mockT = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('slate-react', () => ({ useSlateStatic: () => mockEditor, useReadOnly: () => mockReadOnly }));
jest.mock('@/components/app/app.hooks', () => ({ useAIEnabled: () => mockAIEnabled }));
jest.mock('@/components/editor/EditorContext', () => ({ useEditorContext: () => ({ workspaceId: mockWorkspaceId, viewId: 'view' }) }));
jest.mock('@/components/chat/request/writer-request', () => ({ WriterRequest: jest.fn().mockImplementation(() => ({ fetchAIAssistant: mockFetch })) }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  loadMentionableUsers: jest.fn(async () => [{ name: 'Annie Wang', email: 'private@example.com' }]),
}));
jest.mock('../ai-meeting.summary-regenerate', () => ({
  ...jest.requireActual('../ai-meeting.summary-regenerate'),
  fetchSummaryRegenerateTemplateConfig: jest.fn(async () => null),
}));

function fixture(data: AIMeetingBlockData = { title: 'Search review', speaker_info_map: { A: { name: 'Annie' } } }) {
  const doc = new Y.Doc();

  docs.push(doc);
  initializeDocumentStructure(doc, false, 'summary');
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const meeting = createBlock(sharedRoot, { ty: BlockType.AIMeetingBlock, data: { selected_tab_index: 1, show_notes_directly: true, ...data } });

  updateBlockParent(sharedRoot, meeting, getBlock(sharedRoot.get(YjsEditorKey.document).get(YjsEditorKey.page_id), sharedRoot), 0);
  mockEditor = { sharedRoot } as YjsEditor;
  const blockId = meeting.get(YjsEditorKey.block_id);

  initializeMeetingSections(mockEditor, blockId);
  const [summaryId, notesId, transcriptId] = getChildrenArray(meeting.get(YjsEditorKey.block_children), sharedRoot).toArray();
  const staleNode = traverseBlock(blockId, sharedRoot) as AIMeetingNode;
  const hook = renderHook(() => useAIMeetingRegenerate({ node: staleNode }));
  const applyTranscript = () => applyAudioTranscript(mockEditor, blockId, transcriptId, {
    id: 'job', text: 'The search shortcut is broken.', language: 'en',
    segments: [{ speaker: 'A', start: 403, end: 410, text: 'The search shortcut is broken.' }],
  });

  return { ...hook, sharedRoot, meeting, blockId, summaryId, notesId, transcriptId, applyTranscript };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReadOnly = false;
  mockAIEnabled = true;
  mockWorkspaceId = 'workspace';
  mockFetch.mockReset();
  jest.mocked(fetchSummaryRegenerateTemplateConfig).mockResolvedValue(null);
  jest.spyOn(CustomEditor, 'setBlockData').mockImplementation((editor, blockId, data) => {
    updateMeetingData(editor, blockId, data as Partial<AIMeetingBlockData>);
  });
});

describe('Flutter speaker preprocessing before summary generation', () => {
  const respond = (response: string) => async (_payload: unknown, callback: (text: string, comment: string) => void) => {
    callback(response, '');
    return { streamPromise: Promise.resolve() };
  };

  it('infers names/title before the summary, persists them, and uses the names with stable source IDs', async () => {
    const { result, meeting, sharedRoot, summaryId, notesId, transcriptId, applyTranscript } = fixture({ summary_language: 'FR' });

    applyTranscript();
    replaceBlockChildrenWithMarkdown({ editor: mockEditor, blockId: notesId, markdown: 'Annie is presenting.' });
    const sourceId = ((traverseBlock(transcriptId, sharedRoot)!.children[0] as Element).children[0] as Element).blockId!;

    mockFetch.mockImplementationOnce(respond('{"speakers":{"A":"Annie Wang"},"title":"Search planning"}'))
      .mockImplementationOnce(respond(`Search needs fixing {ref:${sourceId}}.`));
    await act(async () => { await result.current.handleTranscriptReady(); });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [preprocess, summary] = mockFetch.mock.calls.map(([payload]) => payload);

    expect(preprocess).toMatchObject({ assistantType: 8, inputText: 'Speaker A: The search shortcut is broken.' });
    expect(preprocess.customPrompt).toContain('## Current Speaker Labels\n- A: Currently labeled as "Speaker A"');
    expect(preprocess.customPrompt).toContain('code: fr');
    expect(preprocess.customPrompt).toContain('Annie is presenting.');
    expect(preprocess.customPrompt).toContain('- Annie Wang');
    expect(preprocess.customPrompt).not.toContain('private@example.com');
    expect(summary.inputText).toContain(`[BLOCK:${sourceId}] Annie Wang: The search shortcut is broken.`);
    expect(dataStringTOJson(meeting.get(YjsEditorKey.block_data))).toMatchObject({ title: 'Search planning', speaker_info_map: '{"A":{"name":"Annie Wang"}}' });
    expect([...Node.texts(traverseBlock(summaryId, sharedRoot)!)].find(([leaf]) => leaf.reference)?.[0].reference).toEqual({ blockIds: [sourceId], number: 1 });
  });

  it('stays busy during preprocessing and does not start the summary until inference finishes', async () => {
    const { result, applyTranscript } = fixture({});

    applyTranscript();
    let finish!: () => void;
    const inferenceStream = new Promise<void>((resolve) => { finish = resolve; });

    mockFetch.mockImplementationOnce(async (_payload, callback) => {
      callback('{"speakers":{"A":"Annie"},"title":null}', '');
      return { streamPromise: inferenceStream };
    }).mockImplementationOnce(respond('Search needs fixing.'));
    let running!: Promise<void>;

    act(() => { running = result.current.handleTranscriptReady(); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(result.current.isPreprocessingSpeakers).toBe(true);
    expect(result.current.isRegeneratingSummary).toBe(true);
    await act(async () => { await result.current.handleTranscriptReady(); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await running; });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.current.isPreprocessingSpeakers).toBe(false);
    expect(result.current.isRegeneratingSummary).toBe(false);
  });

  it('preprocesses speakers while the independent template request is pending, then waits for the template before summarizing', async () => {
    let finishTemplate!: (value: null) => void;

    jest.mocked(fetchSummaryRegenerateTemplateConfig).mockReturnValue(new Promise((resolve) => { finishTemplate = resolve; }));
    const { result, applyTranscript } = fixture({});

    applyTranscript();
    mockFetch.mockImplementationOnce(respond('{"speakers":{"A":"Annie"},"title":"Search review"}'))
      .mockImplementationOnce(respond('Search needs fixing.'));
    let running!: Promise<void>;

    act(() => { running = result.current.handleTranscriptReady(); });
    try {
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(result.current.isPreprocessingSpeakers).toBe(false));
      expect(mockFetch.mock.calls[0][0].assistantType).toBe(8);
      expect(result.current.isRegeneratingSummary).toBe(true);
    } finally {
      await act(async () => { finishTemplate(null); await running; });
    }

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0].inputText).toContain('Annie:');
  });

  it.each(['network error', 'malformed JSON', 'unknown names'])('continues generating the summary after %s', async (failure) => {
    const { result, meeting, summaryId, sharedRoot, applyTranscript } = fixture({ title: 'Imported video' });

    applyTranscript();
    if (failure === 'network error') mockFetch.mockRejectedValueOnce(new Error('Offline'));
    else mockFetch.mockImplementationOnce(respond(failure === 'malformed JSON' ? 'not JSON' : '{"speakers":{"A":null},"title":null}'));
    mockFetch.mockImplementationOnce(respond('A usable summary.'));
    await act(async () => { await result.current.handleTranscriptReady(); });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0].inputText).toContain('Speaker A:');
    expect(Node.string(traverseBlock(summaryId, sharedRoot)!)).toBe('A usable summary.');
    expect(dataStringTOJson(meeting.get(YjsEditorKey.block_data))).toMatchObject({ title: 'Imported video' });
    expect(notify.error).not.toHaveBeenCalled();
    expect(result.current.isRegeneratingSummary).toBe(false);
  });

  it('preserves custom speaker names and a custom title, including edits while inference streams', async () => {
    const { result, meeting, blockId, applyTranscript } = fixture({});

    applyTranscript();
    let finish!: () => void;
    const inferenceStream = new Promise<void>((resolve) => { finish = resolve; });

    mockFetch.mockImplementationOnce(async (_payload, callback) => {
      callback('{"speakers":{"A":"AI guess"},"title":"AI title"}', '');
      return { streamPromise: inferenceStream };
    }).mockImplementationOnce(respond('Summary using edited names.'));
    let running!: Promise<void>;

    act(() => { running = result.current.handleTranscriptReady(); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const manualNames = { A: { name: 'Manually named', email: 'member@example.com', avatar_url: 'avatar' } };

    updateMeetingData(mockEditor, blockId, { title: 'My title', speaker_info_map: JSON.stringify(manualNames) });
    await act(async () => { finish(); await running; });
    expect(dataStringTOJson(meeting.get(YjsEditorKey.block_data))).toMatchObject({ title: 'My title', speaker_info_map: JSON.stringify(manualNames) });
    expect(mockFetch.mock.calls[1][0].inputText).toContain('Manually named:');
  });

  it('preprocesses a newly imported transcript without replacing an existing summary', async () => {
    const { result, meeting, summaryId, sharedRoot, applyTranscript } = fixture({ title: 'Imported video' });

    applyTranscript();
    replaceBlockChildrenWithMarkdown({ editor: mockEditor, blockId: summaryId, markdown: 'My previous summary' });
    mockFetch.mockImplementationOnce(respond('{"speakers":{"A":"Annie"},"title":"New title"}'));
    await act(async () => { await result.current.handleTranscriptReady(); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(Node.string(traverseBlock(summaryId, sharedRoot)!)).toBe('My previous summary');
    expect(dataStringTOJson(meeting.get(YjsEditorKey.block_data))).toMatchObject({ title: 'Imported video', speaker_info_map: '{"A":{"name":"Annie"}}' });
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('skips preprocessing when speakers and title are custom; Regenerate still generates a summary', async () => {
    const { result, summaryId, applyTranscript } = fixture();

    applyTranscript();
    replaceBlockChildrenWithMarkdown({ editor: mockEditor, blockId: summaryId, markdown: 'Existing summary' });
    await act(async () => { await result.current.handleTranscriptReady(); });
    expect(mockFetch).not.toHaveBeenCalled();
    mockFetch.mockImplementationOnce(respond('Regenerated summary'));
    await act(async () => { await result.current.handleRegenerateSummary(); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0].inputText).toContain('Annie:');
  });

  it('does not preprocess a notes-only block', async () => {
    const { result, notesId } = fixture({});

    replaceBlockChildrenWithMarkdown({ editor: mockEditor, blockId: notesId, markdown: 'Manual notes only' });
    mockFetch.mockImplementationOnce(respond('Notes summary'));
    await act(async () => { await result.current.handleRegenerateSummary(); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0].inputText).toContain('Manual Notes:');
    expect(mockFetch.mock.calls[0][0].customPrompt).not.toContain('## Current Speaker Labels');
  });

  it.each(['unmount', 'read-only', 'AI disabled', 'deleted block'])('ignores stale inference after %s', async (change) => {
    const { result, meeting, blockId, sharedRoot, rerender, unmount, applyTranscript } = fixture({});

    applyTranscript();
    let finish!: () => void;
    const inferenceStream = new Promise<void>((resolve) => { finish = resolve; });

    mockFetch.mockImplementationOnce(async (_payload, callback) => {
      callback('{"speakers":{"A":"Stale name"},"title":"Stale title"}', '');
      return { streamPromise: inferenceStream };
    });
    let running!: Promise<void>;

    act(() => { running = result.current.handleTranscriptReady(); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    if (change === 'unmount') unmount();
    if (change === 'read-only') {
      mockReadOnly = true;
      rerender();
    }

    if (change === 'AI disabled') {
      mockAIEnabled = false;
      rerender();
    }

    if (change === 'deleted block') deleteBlock(sharedRoot, blockId);
    await act(async () => { finish(); await running; });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    if (change !== 'deleted block') expect(dataStringTOJson(meeting.get(YjsEditorKey.block_data))).not.toHaveProperty('speaker_info_map');
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });
});
afterEach(() => {
  cleanup();
  docs.splice(0).forEach((doc) => doc.destroy());
  jest.restoreAllMocks();
});

describe('transcription to cited summary lifecycle', () => {
  it.each(['completed', 'failed'])('cancels the stream immediately and preserves the saved summary after a late %s response', async (response) => {
    const { result, summaryId, transcriptId, sharedRoot, applyTranscript } = fixture();

    applyTranscript();
    replaceBlockChildrenWithMarkdown({ editor: mockEditor, blockId: summaryId, markdown: '## Overview\n\nPrevious summary' });
    const summaryBefore = traverseBlock(summaryId, sharedRoot);
    const transcriptBefore = traverseBlock(transcriptId, sharedRoot);
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const streamPromise = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });

    mockFetch.mockImplementation(async (_payload, callback) => {
      callback('Partial replacement', '');
      return { streamPromise };
    });
    let running!: Promise<void>;

    act(() => { running = result.current.handleRegenerateSummary(); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const signal = mockFetch.mock.calls[0][0].signal as AbortSignal;

    act(() => { result.current.handleCancelSummary(); });
    expect(signal.aborted).toBe(true);
    expect(result.current.isRegeneratingSummary).toBe(false);
    expect(result.current.isPreprocessingSpeakers).toBe(false);
    expect(traverseBlock(summaryId, sharedRoot)).toEqual(summaryBefore);
    await act(async () => {
      if (response === 'completed') finish();
      else fail(new Error('Aborted stream'));
      await running;
    });
    expect(traverseBlock(summaryId, sharedRoot)).toEqual(summaryBefore);
    expect(traverseBlock(transcriptId, sharedRoot)).toEqual(transcriptBefore);
    expect(result.current.summaryError).toBeUndefined();
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('allows regeneration again immediately and ignores an older cancelled stream finishing during the new request', async () => {
    const { result, summaryId, sharedRoot, applyTranscript } = fixture();

    applyTranscript();
    let finishOld!: () => void;
    let finishNew!: () => void;
    const oldStream = new Promise<void>((resolve) => { finishOld = resolve; });
    const newStream = new Promise<void>((resolve) => { finishNew = resolve; });

    mockFetch.mockImplementationOnce(async (_payload, callback) => {
      callback('Cancelled summary', '');
      return { streamPromise: oldStream };
    }).mockImplementationOnce(async (_payload, callback) => {
      callback('## Overview\n\nNew summary', '');
      return { streamPromise: newStream };
    });
    let oldRequest!: Promise<void>;
    let newRequest!: Promise<void>;

    act(() => { oldRequest = result.current.handleRegenerateSummary(); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    act(() => { result.current.handleCancelSummary(); });
    act(() => { newRequest = result.current.handleRegenerateSummary(); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    await act(async () => { finishOld(); await oldRequest; });
    expect(result.current.isRegeneratingSummary).toBe(true);
    expect(mockFetch.mock.calls[1][0].signal.aborted).toBe(false);
    expect(Node.string(traverseBlock(summaryId, sharedRoot)!)).toBe('');
    await act(async () => { await result.current.handleRegenerateSummary(); });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await act(async () => { finishNew(); await newRequest; });
    expect(Node.string(traverseBlock(summaryId, sharedRoot)!)).toBe('OverviewNew summary');
    expect(result.current.isRegeneratingSummary).toBe(false);
    expect(notify.success).toHaveBeenCalledTimes(1);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('cancels while loading the shared template without starting a completion request afterwards', async () => {
    let finishTemplate!: (value: null) => void;
    const templateRequest = new Promise<null>((resolve) => { finishTemplate = resolve; });

    jest.mocked(fetchSummaryRegenerateTemplateConfig).mockReturnValue(templateRequest);
    const { result, applyTranscript } = fixture();

    applyTranscript();
    let running!: Promise<void>;

    act(() => { running = result.current.handleRegenerateSummary(); });
    expect(result.current.isRegeneratingSummary).toBe(true);
    act(() => { result.current.handleCancelSummary(); });
    expect(result.current.isRegeneratingSummary).toBe(false);
    await act(async () => { finishTemplate(null); await running; });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('cancels speaker preprocessing without applying late names or starting a summary', async () => {
    const { result, meeting, applyTranscript } = fixture({});

    applyTranscript();
    let finish!: () => void;
    const streamPromise = new Promise<void>((resolve) => { finish = resolve; });

    mockFetch.mockImplementation(async (_payload, callback) => {
      callback('{"speakers":{"A":"Late name"},"title":"Late title"}', '');
      return { streamPromise };
    });
    let running!: Promise<void>;

    act(() => { running = result.current.handleTranscriptReady(); });
    await waitFor(() => expect(result.current.isPreprocessingSpeakers).toBe(true));
    act(() => { result.current.handleCancelSummary(); });
    expect(result.current.isRegeneratingSummary).toBe(false);
    expect(result.current.isPreprocessingSpeakers).toBe(false);
    expect(mockFetch.mock.calls[0][0].signal.aborted).toBe(true);
    await act(async () => { finish(); await running; });
    expect(dataStringTOJson(meeting.get(YjsEditorKey.block_data))).not.toHaveProperty('speaker_info_map');
    expect(dataStringTOJson(meeting.get(YjsEditorKey.block_data))).not.toHaveProperty('title');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('waits for the shared Flutter template before generating the first summary and keeps the saved template selection', async () => {
    let finishTemplate!: (value: Awaited<ReturnType<typeof fetchSummaryRegenerateTemplateConfig>>) => void;
    const templateRequest = new Promise<Awaited<ReturnType<typeof fetchSummaryRegenerateTemplateConfig>>>((resolve) => { finishTemplate = resolve; });

    jest.mocked(fetchSummaryRegenerateTemplateConfig).mockReturnValue(templateRequest);
    const { result, applyTranscript } = fixture({ title: 'Imported video', speaker_info_map: { A: { name: 'Annie' } }, summary_template: 'interview', summary_detail: 'brief' });

    applyTranscript();
    mockFetch.mockImplementation(async (_payload, callback) => {
      callback('## Overview\n\nAn executive interview.', '');
      return { streamPromise: Promise.resolve() };
    });
    let running!: Promise<void>;

    act(() => { running = result.current.handleTranscriptReady(); });
    expect(result.current.isRegeneratingSummary).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
    await act(async () => {
      finishTemplate({
        fixedPrompt: 'Native summary template in ${LANGUAGE_CODE}.',
        templateOptions: [{ id: 'interview', defaultLabel: 'Interview', prompt: 'Native interview structure' }],
        templateSections: [],
        detailOptions: [{ id: 'brief', defaultLabel: 'Brief', prompt: 'Native brief instruction' }],
      });
      await running;
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0].customPrompt).toContain('Native summary template in EN.');
    expect(mockFetch.mock.calls[0][0].customPrompt).toContain('Meeting Type Template Prompt: Native interview structure');
    expect(mockFetch.mock.calls[0][0].customPrompt).toContain('Detail Instruction: Native brief instruction');
    expect(mockFetch.mock.calls[0][0].customPrompt).toContain('AFTER its final period');
    expect(result.current.isRegeneratingSummary).toBe(false);
  });

  it.each(['automatic', 'manual'])('repairs a missing Summary section before %s generation', async (mode) => {
    const { result, blockId, sharedRoot, summaryId, transcriptId, notesId, applyTranscript } = fixture();

    applyTranscript();
    const transcriptBefore = traverseBlock(transcriptId, sharedRoot);
    const notesBefore = traverseBlock(notesId, sharedRoot);

    deleteBlock(sharedRoot, summaryId);
    mockFetch.mockImplementation(async (_payload, callback) => {
      callback('Recovered summary', '');
      return { streamPromise: Promise.resolve() };
    });
    await act(async () => {
      await (mode === 'automatic' ? result.current.handleTranscriptReady() : result.current.handleRegenerateSummary());
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const meeting = traverseBlock(blockId, sharedRoot)!;
    const summary = meeting.children.find((child) => Element.isElement(child) && child.type === BlockType.AIMeetingSummaryBlock)!;

    expect(Node.string(summary)).toBe('Recovered summary');
    expect(traverseBlock(transcriptId, sharedRoot)).toEqual(transcriptBefore);
    expect(traverseBlock(notesId, sharedRoot)).toEqual(notesBefore);
    expect(result.current.summaryError).toBeUndefined();
  });

  it('reads newly imported paragraphs before Slate renders, stays busy for the entire stream, and saves source references', async () => {
    const { result, sharedRoot, meeting, summaryId, transcriptId, applyTranscript } = fixture();

    applyTranscript();
    const transcript = traverseBlock(transcriptId, sharedRoot)!;
    const sourceId = ((transcript.children[0] as Element).children[0] as Element).blockId!;
    let resolveStream!: () => void;
    let onMessage!: (text: string, comment: string) => void;
    const streamPromise = new Promise<void>((resolve) => { resolveStream = resolve; });

    mockFetch.mockImplementation(async (_payload, callback) => {
      onMessage = callback;
      return { streamPromise };
    });
    let running!: Promise<void>;

    act(() => { running = result.current.handleRegenerateSummary(); });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch.mock.calls[0][0]).toMatchObject({ inputText: `Transcript:\n[BLOCK:${sourceId}] Annie: The search shortcut is broken.` });
    expect(mockFetch.mock.calls[0][0].customPrompt).toContain('{ref:block_id}');
    expect(result.current.isRegeneratingSummary).toBe(true);
    expect(dataStringTOJson(meeting.get(YjsEditorKey.block_data))).toMatchObject({ selected_tab_index: 0, show_notes_directly: false });
    await act(async () => { await result.current.handleRegenerateSummary(); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    act(() => { onMessage(`- **Search shortcut** needs fixing {ref:${sourceId}}.`, ''); });
    expect(result.current.isRegeneratingSummary).toBe(true);
    await act(async () => { resolveStream(); await running; });
    expect(result.current.isRegeneratingSummary).toBe(false);
    const saved = traverseBlock(summaryId, sharedRoot)!;
    const references = [...Node.texts(saved)].filter(([leaf]) => leaf.reference);

    expect(references).toHaveLength(1);
    expect(references[0][0]).toMatchObject({ text: '^', reference: { blockIds: [sourceId], number: 1 } });
    expect([...Node.texts(saved)].some(([leaf]) => leaf.bold && leaf.text === 'Search shortcut')).toBe(true);
    expect(notify.success).toHaveBeenCalled();
  });

  it.each(['request', 'stream'])('clears loading and keeps the previous summary when the %s fails', async (stage) => {
    const { result, summaryId, sharedRoot, applyTranscript } = fixture();

    applyTranscript();
    replaceBlockChildrenWithMarkdown({ editor: mockEditor, blockId: summaryId, markdown: 'Previous summary' });
    const error = new Error('Network unavailable');

    if (stage === 'request') mockFetch.mockRejectedValueOnce(error);
    else mockFetch.mockImplementationOnce(async (_payload, callback) => {
      callback('Unfinished summary', '');
      return { streamPromise: Promise.reject(error) };
    });
    jest.spyOn(console, 'error').mockImplementation(jest.fn());
    await act(async () => { await result.current.handleRegenerateSummary(); });
    expect(result.current.isRegeneratingSummary).toBe(false);
    expect(Node.string(traverseBlock(summaryId, sharedRoot)!)).toBe('Previous summary');
    const message = 'Failed to regenerate summary: Something went wrong. Contact support if this keeps happening.';

    expect(notify.error).toHaveBeenCalledWith(message);
    expect(result.current.summaryError).toBe(message);
    expect(result.current.summaryErrorCode).toBeUndefined();
    act(() => { result.current.dismissSummaryError(); });
    expect(result.current.summaryError).toBeUndefined();
  });

  it('clears the generation error when retrying and saves the successful summary', async () => {
    const { result, summaryId, sharedRoot, applyTranscript } = fixture();

    applyTranscript();
    jest.spyOn(console, 'error').mockImplementation(jest.fn());
    mockFetch.mockRejectedValueOnce(new Error('Offline')).mockImplementationOnce(async (_payload, callback) => {
      callback('Retry succeeded', '');
      return { streamPromise: Promise.resolve() };
    });
    await act(async () => { await result.current.handleRegenerateSummary(); });
    expect(result.current.summaryError).toBeTruthy();
    await act(async () => { await result.current.handleRegenerateSummary(); });
    expect(Node.string(traverseBlock(summaryId, sharedRoot)!)).toBe('Retry succeeded');
    expect(result.current.summaryError).toBeUndefined();
    expect(result.current.isRegeneratingSummary).toBe(false);
  });

  it('clears a previous workspace generation error and closes its menu when changing workspaces', async () => {
    const { result, rerender, applyTranscript } = fixture();

    applyTranscript();
    jest.spyOn(console, 'error').mockImplementation(jest.fn());
    mockFetch.mockRejectedValueOnce({ code: 1033, message: 'Workspace AI limit reached' });
    await act(async () => { await result.current.handleRegenerateSummary(); });
    act(() => { result.current.setRegenerateMenuOpen(true); });
    expect(result.current.summaryErrorCode).toBe(1033);

    mockWorkspaceId = 'another-workspace';
    rerender();
    expect(result.current.summaryError).toBeUndefined();
    expect(result.current.summaryErrorCode).toBeUndefined();
    expect(result.current.regenerateMenuOpen).toBe(false);
  });

  it('preserves the public server explanation for the AI response limit', async () => {
    const { result, summaryId, transcriptId, sharedRoot, applyTranscript } = fixture();

    applyTranscript();
    replaceBlockChildrenWithMarkdown({ editor: mockEditor, blockId: summaryId, markdown: '## Overview\n\nExisting summary.' });
    const summaryBefore = traverseBlock(summaryId, sharedRoot);
    const transcriptBefore = traverseBlock(transcriptId, sharedRoot);
    const message = 'This workspace has hit the free limit for AI responses. Please ask the owner to upgrade to Pro.';

    jest.spyOn(console, 'error').mockImplementation(jest.fn());
    mockFetch.mockRejectedValueOnce({
      code: 1033,
      message: 'Internal quota diagnostic',
      user_error: { schema_version: 1, reason: 'AI_RESPONSE_LIMIT_REACHED', locale: 'en', message },
    });
    await act(async () => { await result.current.handleRegenerateSummary(); });
    expect(result.current.summaryError).toBe(`Failed to regenerate summary: ${message}`);
    expect(result.current.summaryErrorCode).toBe(1033);
    expect(notify.error).toHaveBeenCalledWith(`Failed to regenerate summary: ${message}`);
    expect(result.current.isRegeneratingSummary).toBe(false);
    expect(traverseBlock(summaryId, sharedRoot)).toEqual(summaryBefore);
    expect(traverseBlock(transcriptId, sharedRoot)).toEqual(transcriptBefore);
    expect(notify.success).not.toHaveBeenCalled();
    act(() => { result.current.dismissSummaryError(); });
    expect(result.current.summaryError).toBeUndefined();
    expect(result.current.summaryErrorCode).toBeUndefined();
  });

  it('does not generate without source content, on read-only pages, or after the meeting is deleted', async () => {
    const { result, rerender, sharedRoot, blockId, applyTranscript } = fixture();

    await act(async () => { await result.current.handleRegenerateSummary(); });
    expect(notify.error).toHaveBeenCalledWith(expect.stringContaining('No transcript or notes'));
    applyTranscript();
    mockReadOnly = true;
    rerender();
    await act(async () => { await result.current.handleRegenerateSummary(); });
    mockReadOnly = false;
    rerender();
    deleteBlock(sharedRoot, blockId);
    await act(async () => { await result.current.handleRegenerateSummary(); });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
