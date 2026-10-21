import * as Y from 'yjs';
import { Element } from 'slate';

import { applyAudioTranscript, initializeMeetingSections, updateMeetingData } from '../ai-meeting.import';
import { YjsEditor } from '@/application/slate-yjs';
import { traverseBlock } from '@/application/slate-yjs/utils/convert';
import { createBlock, dataStringTOJson, deleteBlock, getBlock, getChildrenArray, initializeDocumentStructure, updateBlockParent } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YjsEditorKey, YSharedRoot } from '@/application/types';

function fixture(data = {}) {
  const doc = new Y.Doc();

  initializeDocumentStructure(doc, false, 'document');
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const document = sharedRoot.get(YjsEditorKey.document);
  const page = getBlock(document.get(YjsEditorKey.page_id), sharedRoot);
  const meeting = createBlock(sharedRoot, { ty: BlockType.AIMeetingBlock, data });

  updateBlockParent(sharedRoot, meeting, page, 0);
  const blockId = meeting.get(YjsEditorKey.block_id);
  const editor = { sharedRoot } as YjsEditor;

  initializeMeetingSections(editor, blockId);
  const sectionIds = getChildrenArray(meeting.get(YjsEditorKey.block_children), sharedRoot).toArray();

  return { doc, editor, sharedRoot, blockId, transcriptId: sectionIds[2], meeting };
}

describe('Flutter transcript document persistence', () => {
  it('creates Summary, Notes and Transcript with empty paragraphs for a new web block', () => {
    const { editor, blockId, sharedRoot } = fixture();
    const before = traverseBlock(blockId, sharedRoot);

    expect(before?.children.map((section) => 'type' in section ? section.type : '')).toEqual([
      BlockType.AIMeetingSummaryBlock, BlockType.AIMeetingNotesBlock, BlockType.AIMeetingTranscriptionBlock,
    ]);
    initializeMeetingSections(editor, blockId);
    expect(traverseBlock(blockId, sharedRoot)).toEqual(before);
  });

  it.each([
    [[0]], [[1]], [[2]], [[0, 1]], [[0, 2]], [[1, 2]], [[0, 1, 2]],
  ])('repairs missing sections %j without changing existing content or source IDs', (missing) => {
    const { editor, blockId, sharedRoot, transcriptId, meeting } = fixture({ title: 'Imported video' });

    applyAudioTranscript(editor, blockId, transcriptId, { id: 'job', text: 'Keep this transcript', segments: [] });
    const sections = traverseBlock(blockId, sharedRoot)!.children;

    missing.forEach((index) => deleteBlock(sharedRoot, (sections[index] as { blockId: string }).blockId));
    const preserved = traverseBlock(blockId, sharedRoot)!.children.filter(Element.isElement);
    const beforeData = meeting.get(YjsEditorKey.block_data);

    initializeMeetingSections(editor, blockId);
    const restored = traverseBlock(blockId, sharedRoot)!;

    expect(restored.children.map((section) => 'type' in section && section.type)).toEqual([
      BlockType.AIMeetingSummaryBlock, BlockType.AIMeetingNotesBlock, BlockType.AIMeetingTranscriptionBlock,
    ]);
    preserved.forEach((section) => expect(restored.children).toContainEqual(section));
    expect(meeting.get(YjsEditorKey.block_data)).toBe(beforeData);
    initializeMeetingSections(editor, blockId);
    expect(traverseBlock(blockId, sharedRoot)).toEqual(restored);
  });

  it('persists speakers, timestamps, language, job and meeting lifecycle metadata', () => {
    const { editor, blockId, transcriptId, sharedRoot, meeting } = fixture({ meeting_source: 'google_calendar', title: 'Custom title' });

    expect(applyAudioTranscript(editor, blockId, transcriptId, {
      id: 'job', text: 'Hi', language: 'fr', segments: [{ text: 'Hi', speaker: 'A', start: 1.2, end: 3.5 }],
    })).toBe(true);
    expect(dataStringTOJson(meeting.get(YjsEditorKey.block_data))).toMatchObject({
      title: 'Custom title', meeting_source: 'google_calendar', transcript_id: 'job', transcript_language: 'fr',
      summary_language: 'fr', recording_state: 'recorded', show_notes_directly: false,
    });
    const node = traverseBlock(transcriptId, sharedRoot);

    expect(node?.children[0]).toMatchObject({ type: BlockType.AIMeetingSpeakerBlock, data: { speaker_id: 'A', timestamp: 1.2, end_timestamp: 3.5 } });
    expect(JSON.stringify(node)).toContain('Hi');
  });

  it('replaces old transcript children without duplicates and keeps Notes/Summary intact', () => {
    const { editor, blockId, transcriptId, sharedRoot } = fixture();
    const first = { id: 'first', text: 'Old transcript', segments: [] };

    applyAudioTranscript(editor, blockId, transcriptId, first);
    const before = traverseBlock(blockId, sharedRoot);

    applyAudioTranscript(editor, blockId, transcriptId, { id: 'second', text: 'New transcript\n\nNext paragraph', segments: [] });
    const after = traverseBlock(blockId, sharedRoot);

    expect(after?.children.slice(0, 2)).toEqual(before?.children.slice(0, 2));
    expect(JSON.stringify(after)).not.toContain('Old transcript');
    expect(JSON.stringify(after)).toContain('New transcript');
    expect(traverseBlock(transcriptId, sharedRoot)?.children).toHaveLength(2);
  });

  it('preserves the user’s chosen summary language', () => {
    const { editor, blockId, transcriptId, meeting } = fixture({ summary_language: 'de' });

    applyAudioTranscript(editor, blockId, transcriptId, { id: 'job', text: 'Text', language: 'es', segments: [] });
    expect(dataStringTOJson(meeting.get(YjsEditorKey.block_data))).toMatchObject({ summary_language: 'de', transcript_language: 'es' });
  });

  it('preserves unknown saved transcript language when no supported language is detected', () => {
    const { editor, blockId, transcriptId, meeting } = fixture({ transcript_language: 'zh' });

    applyAudioTranscript(editor, blockId, transcriptId, { id: 'job', text: 'Text', segments: [] });
    expect(dataStringTOJson(meeting.get(YjsEditorKey.block_data))).toMatchObject({ transcript_language: 'zh' });
  });

  it('does not recreate a deleted meeting or transcript after a late response', () => {
    const { editor, blockId, transcriptId, sharedRoot } = fixture();

    deleteBlock(sharedRoot, blockId);
    expect(applyAudioTranscript(editor, blockId, transcriptId, { id: 'job', text: 'Text', segments: [] })).toBe(false);
    expect(() => updateMeetingData(editor, blockId, { title: 'Late' })).not.toThrow();
  });

  it('survives serialization and page reopening with metadata and transcript content intact', () => {
    const { doc, editor, blockId, transcriptId, sharedRoot } = fixture({ title: 'Recording', transcription_type: 'audioFile' });

    applyAudioTranscript(editor, blockId, transcriptId, { id: 'job', text: 'Persisted words', segments: [] });
    const reopened = new Y.Doc();

    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
    const restored = reopened.getMap(YjsEditorKey.data_section) as YSharedRoot;

    expect(traverseBlock(blockId, restored)).toEqual(traverseBlock(blockId, sharedRoot));
  });
});
