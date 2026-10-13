import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Element, Node } from 'slate';
import * as Y from 'yjs';

import translations from '@/@types/translations/en.json';
import { getSubscriptionLink } from '@/application/services/domains/billing';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { traverseBlock } from '@/application/slate-yjs/utils/convert';
import { createBlock, deleteBlock, getBlock, getChildrenArray, initializeDocumentStructure, updateBlockParent } from '@/application/slate-yjs/utils/yjs';
import { AIMeetingBlockData, BlockType, SubscriptionInterval, SubscriptionPlan, YjsEditorKey, YSharedRoot } from '@/application/types';
import { AIMeetingNode } from '@/components/editor/editor.type';

import { applyAudioTranscript, initializeMeetingSections, updateMeetingData } from '../ai-meeting.import';
import { replaceBlockChildrenWithMarkdown } from '../ai-meeting.summary-regenerate';
import { AIMeetingBlock } from '../AIMeetingBlock';

let mockEditor: YjsEditor;
let mockReadOnly = false;
const mockFetch = jest.fn();
const docs: Y.Doc[] = [];
const mockT = (key: string, options?: Record<string, unknown>) => {
  const value = key.split('.').reduce<unknown>((current, part) => (current as Record<string, unknown>)?.[part], translations);

  return typeof value === 'string' ? value : options?.defaultValue ?? key;
};

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('slate-react', () => ({ useReadOnly: () => mockReadOnly, useSlateStatic: () => mockEditor }));
jest.mock('@/components/app/app.hooks', () => ({ useAIEnabled: () => true }));
jest.mock('@/components/app/hooks/useServerInfo', () => ({ useIsOfficialHosted: () => true }));
jest.mock('@/application/services/domains/billing', () => ({ getSubscriptionLink: jest.fn() }));
jest.mock('@/components/editor/EditorContext', () => ({ useEditorContext: () => ({ workspaceId: 'workspace', viewId: 'view' }) }));
jest.mock('@/components/chat/request/writer-request', () => ({ WriterRequest: jest.fn().mockImplementation(() => ({ fetchAIAssistant: mockFetch })) }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../AIMeetingRecording', () => ({ AIMeetingRecording: () => null }));
jest.mock('../AIMeetingMoreMenu', () => ({ AIMeetingMoreMenu: () => null }));
jest.mock('../useAIMeetingClipboard', () => ({ useAIMeetingClipboard: () => ({ handleCopy: jest.fn() }) }));
jest.mock('../useAIMeetingImport', () => ({
  useAIMeetingImport: () => ({ available: !mockReadOnly, busy: false, stage: 'idle', language: 'en', setLanguage: jest.fn() }),
}));
jest.mock('../ai-meeting.summary-regenerate', () => ({
  ...jest.requireActual('../ai-meeting.summary-regenerate'),
  fetchSummaryRegenerateTemplateConfig: jest.fn(async () => null),
}));

function renderMeeting(missingSummary = false) {
  const doc = new Y.Doc();

  docs.push(doc);
  initializeDocumentStructure(doc, false, 'summary-ui');
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const meeting = createBlock(sharedRoot, { ty: BlockType.AIMeetingBlock, data: { title: 'Imported video', speaker_info_map: { A: { name: 'Annie' } } } });

  updateBlockParent(sharedRoot, meeting, getBlock(sharedRoot.get(YjsEditorKey.document).get(YjsEditorKey.page_id), sharedRoot), 0);
  mockEditor = { sharedRoot, isElementReadOnly: () => false } as unknown as YjsEditor;
  const blockId = meeting.get(YjsEditorKey.block_id);

  initializeMeetingSections(mockEditor, blockId);
  const [summaryId, , transcriptId] = getChildrenArray(meeting.get(YjsEditorKey.block_children), sharedRoot).toArray();

  applyAudioTranscript(mockEditor, blockId, transcriptId, {
    id: 'job', text: 'Fix the search shortcut.', segments: [{ speaker: 'A', start: 403, end: 410, text: 'Fix the search shortcut.' }],
  });
  if (missingSummary) deleteBlock(sharedRoot, summaryId);
  const subscribe = (onChange: () => void) => {
    doc.on('update', onChange);
    return () => doc.off('update', onChange);
  };

  const getSnapshot = () => JSON.stringify(traverseBlock(blockId, sharedRoot));

  function MeetingView() {
    const node = JSON.parse(useSyncExternalStore(subscribe, getSnapshot)) as AIMeetingNode;

    return (
      <MemoryRouter>
        <AIMeetingBlock node={node}>
          {node.children.filter(Element.isElement).map((section) => (
            <div className='block-element' data-block-type={section.type} key={section.blockId}>{Node.string(section)}</div>
          ))}
        </AIMeetingBlock>
      </MemoryRouter>
    );
  }

  return { ...render(<MeetingView />), sharedRoot, blockId, summaryId, transcriptId };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReadOnly = false;
  mockFetch.mockReset();
  jest.spyOn(CustomEditor, 'setBlockData').mockImplementation((editor, blockId, updates) => {
    updateMeetingData(editor, blockId, updates as Partial<AIMeetingBlockData>);
  });
  jest.spyOn(console, 'debug').mockImplementation(jest.fn());
});
afterEach(() => {
  cleanup();
  docs.splice(0).forEach((doc) => doc.destroy());
  jest.restoreAllMocks();
});

describe('AI transcript summary UI with the real generation hook and Yjs document', () => {
  it('repairs a missing Summary, generates from the transcript, then displays and persists the cited result', async () => {
    const { container, sharedRoot, blockId, transcriptId } = renderMeeting(true);
    const transcriptBefore = traverseBlock(transcriptId, sharedRoot)!;
    const sourceId = ((transcriptBefore.children[0] as Element).children[0] as Element).blockId!;
    let finish!: () => void;
    const streamPromise = new Promise<void>((resolve) => { finish = resolve; });

    mockFetch.mockImplementation(async (_payload, callback) => {
      callback(`- Fix the search shortcut {ref:${sourceId}}.`, '');
      return { streamPromise };
    });
    const generate = screen.getByRole('button', { name: 'Generate summary' });

    expect(screen.getByRole('textbox').parentElement?.contains(generate)).toBe(true);
    expect(screen.getByRole('button', { name: 'Summary' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.click(generate);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(container.querySelector('[data-ai-meeting-active="summary"][aria-busy="true"]')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Generating AI summary');
    const cancel = screen.getByRole('button', { name: 'Cancel' });

    expect(cancel.disabled).toBe(false);
    expect(screen.getByRole('textbox').parentElement?.contains(cancel)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Generating' })).toBeNull();
    await act(async () => { finish(); await streamPromise; });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerate' })).toBeTruthy());
    expect(container.querySelector('[data-ai-meeting-active="summary"][aria-busy="false"]')).toBeTruthy();
    expect(screen.getByText('Fix the search shortcut ^.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    const savedSummary = traverseBlock(blockId, sharedRoot)!.children.find((child) => Element.isElement(child) && child.type === BlockType.AIMeetingSummaryBlock)!;

    expect([...Node.texts(savedSummary)].find(([leaf]) => leaf.reference)?.[0].reference).toEqual({ blockIds: [sourceId], number: 1 });
    expect(traverseBlock(transcriptId, sharedRoot)).toEqual(transcriptBefore);
    const reopened = new Y.Doc();

    docs.push(reopened);
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(sharedRoot.doc!));
    expect(traverseBlock(blockId, reopened.getMap(YjsEditorKey.data_section) as YSharedRoot)).toEqual(traverseBlock(blockId, sharedRoot));
  });

  it('keeps Summary available after an API failure and retries from the visible error banner', async () => {
    jest.spyOn(console, 'error').mockImplementation(jest.fn());
    const { container } = renderMeeting();

    mockFetch.mockRejectedValueOnce(new Error('Offline')).mockImplementationOnce(async (_payload, callback) => {
      callback('Summary after retry.', '');
      return { streamPromise: Promise.resolve() };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate summary' }));
    expect((await screen.findByRole('alert')).textContent).toContain(translations.document.aiMeeting.regenerate.failed);
    expect(container.querySelector('[data-ai-meeting-active="summary"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Summary' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Summary after retry.')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeTruthy();
  });

  it('keeps generation controls and an empty Summary hidden on read-only pages', () => {
    mockReadOnly = true;
    renderMeeting();
    expect(screen.queryByRole('button', { name: 'Generate summary' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Summary' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Transcript' })).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('offers direct Stripe checkout for the server AI-response limit while preserving the saved summary', async () => {
    jest.spyOn(console, 'error').mockImplementation(jest.fn());
    const { sharedRoot, summaryId } = renderMeeting();

    act(() => { replaceBlockChildrenWithMarkdown({ editor: mockEditor, blockId: summaryId, markdown: '## Overview\n\nSaved summary.' }); });
    const summaryBefore = traverseBlock(summaryId, sharedRoot);
    const message = 'This workspace has hit the free limit for AI responses. Please ask the owner to upgrade to Pro.';

    mockFetch.mockRejectedValueOnce({
      code: 1033,
      message: 'Internal quota diagnostic',
      user_error: { schema_version: 1, reason: 'AI_RESPONSE_LIMIT_REACHED', locale: 'en', message },
    });
    jest.mocked(getSubscriptionLink).mockResolvedValueOnce('https://checkout.stripe.com/c/pay/test-pro-checkout');
    jest.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Upgrade' })); });
    expect(getSubscriptionLink).toHaveBeenCalledWith('workspace', SubscriptionPlan.Pro, SubscriptionInterval.Month);
    expect(window.open).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/test-pro-checkout', '_current');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
    expect(traverseBlock(summaryId, sharedRoot)).toEqual(summaryBefore);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss summary error' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cancels regeneration from the title row and restores Regenerate without replacing the saved summary', async () => {
    const { container, sharedRoot, summaryId } = renderMeeting();

    act(() => { replaceBlockChildrenWithMarkdown({ editor: mockEditor, blockId: summaryId, markdown: '## Overview\n\nSaved summary.' }); });
    const savedSummary = traverseBlock(summaryId, sharedRoot);
    let finish!: () => void;
    const streamPromise = new Promise<void>((resolve) => { finish = resolve; });

    mockFetch.mockImplementation(async (_payload, callback) => {
      callback('Unfinished replacement', '');
      return { streamPromise };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const cancel = screen.getByRole('button', { name: 'Cancel' });

    expect(screen.getByRole('textbox').parentElement?.contains(cancel)).toBe(true);
    expect(container.querySelector('.ai-meeting-tabs')?.contains(cancel)).toBe(false);
    expect(screen.queryByRole('button', { name: 'Summary options' })).toBeNull();
    fireEvent.click(cancel);
    expect(mockFetch.mock.calls[0][0].signal.aborted).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(container.querySelector('.ai-meeting-tabs')?.contains(screen.getByRole('button', { name: 'Regenerate' }))).toBe(true);
    await act(async () => { finish(); await streamPromise; });
    expect(traverseBlock(summaryId, sharedRoot)).toEqual(savedSummary);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
