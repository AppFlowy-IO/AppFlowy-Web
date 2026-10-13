import { Element, Node } from 'slate';
import * as Y from 'yjs';

import { YjsEditor } from '@/application/slate-yjs';
import { traverseBlock } from '@/application/slate-yjs/utils/convert';
import { createBlock, deepCopyBlock, deepCopyChildren, getBlock, getChildrenArray, getChildrenMap, getPageId, initializeDocumentStructure, updateBlockParent } from '@/application/slate-yjs/utils/yjs';
import { BlockType, CollabOrigin, YjsEditorKey, YSharedRoot } from '@/application/types';
import { handleBlockDrop } from '@/components/editor/components/drag-drop/handleBlockDrop';
import { parseInlineReference } from '@/components/editor/components/leaf/reference/utils';

import { applyAudioTranscript, initializeMeetingSections } from '../ai-meeting.import';
import { extractMeetingSummarySources } from '../ai-meeting.references';
import { replaceBlockChildrenWithMarkdown } from '../ai-meeting.summary-regenerate';

const docs: Y.Doc[] = [];

afterEach(() => { docs.splice(0).forEach((doc) => doc.destroy()); });

function fixture(nested = false) {
  const doc = new Y.Doc();

  docs.push(doc);
  initializeDocumentStructure(doc, false, 'dragged-meeting');
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const editor = { sharedRoot } as YjsEditor;
  const page = getBlock(getPageId(sharedRoot), sharedRoot);
  const before = createBlock(sharedRoot, { ty: BlockType.Paragraph, data: {} });
  const after = createBlock(sharedRoot, { ty: BlockType.Paragraph, data: {} });
  const meeting = createBlock(sharedRoot, { ty: BlockType.AIMeetingBlock, data: { title: 'Meeting with sources', speaker_info_map: '{"A":{"name":"Annie"}}' } });
  const container = nested ? createBlock(sharedRoot, { ty: BlockType.ToggleListBlock, data: {} }) : meeting;

  updateBlockParent(sharedRoot, before, page, 0);
  updateBlockParent(sharedRoot, container, page, 1);
  updateBlockParent(sharedRoot, after, page, 2);
  if (nested) updateBlockParent(sharedRoot, meeting, container, 0);
  const meetingId = meeting.get(YjsEditorKey.block_id);

  initializeMeetingSections(editor, meetingId);
  const [summaryId, notesId, transcriptId] = getChildrenArray(meeting.get(YjsEditorKey.block_children), sharedRoot).toArray();

  applyAudioTranscript(editor, meetingId, transcriptId, {
    id: 'transcript-job', text: 'Discuss search. Fix the shortcut.', language: 'en',
    segments: [{ speaker: 'A', start: 403, end: 410, text: 'Discuss search.' }, { speaker: 'B', start: 410, end: 420, text: 'Fix the shortcut.' }],
  });
  replaceBlockChildrenWithMarkdown({ editor, blockId: notesId, markdown: 'Manual action item.' });
  const sources = meetingSources(traverseBlock(meetingId, sharedRoot)!);
  const sourceIds = sources.map((source) => source.blockId);

  replaceBlockChildrenWithMarkdown({
    editor, blockId: summaryId,
    markdown: `**Decision** {ref:${sourceIds[0]},${sourceIds[2]}}\n\nContext {ref:${sourceIds[1]}}`,
    referenceBlockIds: new Set(sourceIds),
  });

  return { doc, sharedRoot, editor, page, meetingId, containerId: container.get(YjsEditorKey.block_id), beforeId: before.get(YjsEditorKey.block_id), afterId: after.get(YjsEditorKey.block_id), sourceIds };
}

function meetingSources(meeting: Element) {
  return extractMeetingSummarySources({
    transcriptNode: meeting.children.find((child) => Element.isElement(child) && child.type === BlockType.AIMeetingTranscriptionBlock),
    notesNode: meeting.children.find((child) => Element.isElement(child) && child.type === BlockType.AIMeetingNotesBlock),
    resolveSpeakerName: (id) => id === 'A' ? 'Annie' : 'Speaker B',
  });
}

function currentMeeting(sharedRoot: YSharedRoot): Element {
  const page = traverseBlock(getPageId(sharedRoot), sharedRoot)!;
  const meeting = [...Node.elements(page)].find(([node]) => node.type === BlockType.AIMeetingBlock)?.[0];

  expect(meeting).toBeDefined();
  return meeting!;
}

function expectWorkingReferences(sharedRoot: YSharedRoot, meeting = currentMeeting(sharedRoot)) {
  const sources = meetingSources(meeting);
  const refs = [...Node.texts(meeting)].map(([leaf]) => parseInlineReference(leaf.reference)).filter(Boolean);

  expect(sources.map((source) => source.content)).toEqual(['Discuss search.', 'Fix the shortcut.', 'Manual action item.']);
  expect(refs).toEqual([
    { blockIds: [sources[0].blockId], number: 1 },
    { blockIds: [sources[2].blockId], number: 2 },
    { blockIds: [sources[1].blockId], number: 3 },
  ]);
  refs.forEach((ref) => ref!.blockIds.forEach((id) => expect(getBlock(id, sharedRoot)).toBeDefined()));
  expect([...Node.texts(meeting)].some(([leaf]) => leaf.text === 'Decision' && leaf.bold)).toBe(true);
  const transcript = meeting.children.find((child) => Element.isElement(child) && child.type === BlockType.AIMeetingTranscriptionBlock) as Element;

  expect((transcript.children[0] as Element).data).toMatchObject({ speaker_id: 'A', timestamp: 403 });
  expect(meeting.data).toMatchObject({ title: 'Meeting with sources', speaker_info_map: '{"A":{"name":"Annie"}}' });
}

describe('AI transcript references after dragging or duplicating', () => {
  it('remaps summary references when the whole transcript block is dragged, including repeated moves', () => {
    const f = fixture();

    expectWorkingReferences(f.sharedRoot);
    expect(handleBlockDrop({ editor: f.editor, sourceBlockId: f.meetingId, targetBlockId: f.afterId, edge: 'bottom' })).toBe(true);
    expectWorkingReferences(f.sharedRoot);
    expect(getBlock(f.meetingId, f.sharedRoot)).toBeUndefined();
    f.sourceIds.forEach((id) => expect(getBlock(id, f.sharedRoot)).toBeUndefined());
    const moved = currentMeeting(f.sharedRoot);

    expect(handleBlockDrop({ editor: f.editor, sourceBlockId: moved.blockId!, targetBlockId: f.beforeId, edge: 'top' })).toBe(true);
    expectWorkingReferences(f.sharedRoot);
    // References remain valid after saving and reopening the collaborative document.
    const reopened = new Y.Doc();

    docs.push(reopened);
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(f.doc));
    expectWorkingReferences(reopened.getMap(YjsEditorKey.data_section) as YSharedRoot);
  });

  it('keeps references when dragging an ancestor containing the transcript block', () => {
    const f = fixture(true);

    expect(handleBlockDrop({ editor: f.editor, sourceBlockId: f.containerId, targetBlockId: f.afterId, edge: 'bottom' })).toBe(true);
    expectWorkingReferences(f.sharedRoot);
    expect(getBlock(f.meetingId, f.sharedRoot)).toBeUndefined();
  });

  it('preserves imported sections whose child relation ID differs from their block ID', () => {
    const f = fixture();
    const transcript = currentMeeting(f.sharedRoot).children.find((child) => Element.isElement(child) && child.type === BlockType.AIMeetingTranscriptionBlock) as Element;
    const block = getBlock(transcript.blockId!, f.sharedRoot);
    const previousId = block.get(YjsEditorKey.block_children);
    const importedChildren = new Y.Array<string>();

    importedChildren.insert(0, getChildrenArray(previousId, f.sharedRoot).toArray());
    getChildrenMap(f.sharedRoot).set('imported-transcript-relation', importedChildren);
    getChildrenMap(f.sharedRoot).delete(previousId);
    block.set(YjsEditorKey.block_children, 'imported-transcript-relation');
    expectWorkingReferences(f.sharedRoot);
    expect(handleBlockDrop({ editor: f.editor, sourceBlockId: f.meetingId, targetBlockId: f.afterId, edge: 'bottom' })).toBe(true);
    expectWorkingReferences(f.sharedRoot);
  });

  it('restores matching references and source IDs on undo and redo', () => {
    const f = fixture();
    const undo = new Y.UndoManager(f.sharedRoot, { trackedOrigins: new Set([CollabOrigin.LocalManual]) });

    handleBlockDrop({ editor: f.editor, sourceBlockId: f.meetingId, targetBlockId: f.afterId, edge: 'bottom' });
    expectWorkingReferences(f.sharedRoot);
    undo.undo();
    expectWorkingReferences(f.sharedRoot);
    expect(currentMeeting(f.sharedRoot).blockId).toBe(f.meetingId);
    undo.redo();
    expectWorkingReferences(f.sharedRoot);
    expect(currentMeeting(f.sharedRoot).blockId).not.toBe(f.meetingId);
    undo.destroy();
  });

  it('makes duplicated summaries point to their own sources and leaves the original unchanged', () => {
    const f = fixture();
    const copyId = deepCopyBlock(f.sharedRoot, getBlock(f.meetingId, f.sharedRoot), undefined, true)!;
    const copy = getBlock(copyId, f.sharedRoot);

    updateBlockParent(f.sharedRoot, copy, f.page, 3);
    const copiedMeeting = traverseBlock(copyId, f.sharedRoot)!;

    expectWorkingReferences(f.sharedRoot, copiedMeeting);
    expectWorkingReferences(f.sharedRoot, traverseBlock(f.meetingId, f.sharedRoot)!);
    meetingSources(copiedMeeting).forEach((source) => expect(f.sourceIds).not.toContain(source.blockId));
  });

  it('also remaps references when sections are copied through deepCopyChildren', () => {
    const f = fixture();
    const meeting = getBlock(f.meetingId, f.sharedRoot);
    const copy = createBlock(f.sharedRoot, { ty: BlockType.AIMeetingBlock, data: JSON.parse(meeting.get(YjsEditorKey.block_data)) });

    deepCopyChildren(f.sharedRoot, getChildrenArray(meeting.get(YjsEditorKey.block_children), f.sharedRoot), getChildrenArray(copy.get(YjsEditorKey.block_children), f.sharedRoot), copy.get(YjsEditorKey.block_id));
    expectWorkingReferences(f.sharedRoot, traverseBlock(copy.get(YjsEditorKey.block_id), f.sharedRoot)!);
  });
});
