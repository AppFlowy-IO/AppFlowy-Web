import { Element } from 'slate';

import { AudioTranscriptResult, detectedTranscriptLanguage } from '@/application/integrations/transcription-result';
import { YjsEditor } from '@/application/slate-yjs';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import {
  assertDocExists,
  dataStringTOJson,
  deleteBlock,
  getBlock,
  getChildrenArray,
} from '@/application/slate-yjs/utils/yjs';
import { AIMeetingBlockData, BlockType, YjsEditorKey } from '@/application/types';

export function updateMeetingData(editor: YjsEditor, blockId: string, data: Partial<AIMeetingBlockData>) {
  const block = getBlock(blockId, editor.sharedRoot);

  if (!block) return;
  block.set(
    YjsEditorKey.block_data,
    JSON.stringify({ ...dataStringTOJson(block.get(YjsEditorKey.block_data)), ...data })
  );
}

export function initializeMeetingSections(editor: YjsEditor, blockId: string) {
  const block = getBlock(blockId, editor.sharedRoot);

  if (!block) return;
  const children = getChildrenArray(block.get(YjsEditorKey.block_children), editor.sharedRoot);

  const sectionTypes = [
    BlockType.AIMeetingSummaryBlock,
    BlockType.AIMeetingNotesBlock,
    BlockType.AIMeetingTranscriptionBlock,
  ];

  const doc = assertDocExists(editor.sharedRoot);

  doc.transact(() => {
    // Flutter also repairs partially populated blocks. Keep existing sections
    // and their source IDs intact when adding a missing Summary/Notes/Transcript.
    let insertIndex = 0;

    for (const type of sectionTypes) {
      const existingIndex = children.toArray().findIndex((id) => getBlock(id, editor.sharedRoot)?.get(YjsEditorKey.block_type) === type);

      if (existingIndex >= 0) {
        insertIndex = existingIndex + 1;
        continue;
      }

      const section = {
        type,
        data: {},
        children: [
          { type: BlockType.Paragraph, data: {}, children: [{ type: YjsEditorKey.text, children: [{ text: '' }] }] },
        ],
      };

      slateContentInsertToYData(blockId, insertIndex++, [section] as unknown as Element[], doc);
    }
  });
}

export function applyAudioTranscript(
  editor: YjsEditor,
  blockId: string,
  transcriptBlockId: string,
  result: AudioTranscriptResult
) {
  const meeting = getBlock(blockId, editor.sharedRoot);
  const transcript = getBlock(transcriptBlockId, editor.sharedRoot);

  // The block may have been deleted while its network request was pending.
  if (!meeting || !transcript) return false;
  const children = getChildrenArray(transcript.get(YjsEditorKey.block_children), editor.sharedRoot);
  const paragraph = (text: string) => ({
    type: BlockType.Paragraph,
    data: {},
    children: [{ type: YjsEditorKey.text, children: [{ text }] }],
  });
  const nodes = result.segments.length
    ? result.segments.map((segment) => ({
        type: BlockType.AIMeetingSpeakerBlock,
        data: { speaker_id: segment.speaker, timestamp: segment.start, end_timestamp: segment.end },
        children: [paragraph(segment.text)],
      }))
    : result.text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map(paragraph);
  const currentData = dataStringTOJson(meeting.get(YjsEditorKey.block_data)) as AIMeetingBlockData;
  const language = detectedTranscriptLanguage(result.language);
  const doc = assertDocExists(editor.sharedRoot);

  doc.transact(() => {
    children.toArray().forEach((id) => deleteBlock(editor.sharedRoot, id));
    slateContentInsertToYData(transcriptBlockId, 0, nodes as unknown as Element[], doc);
    updateMeetingData(editor, blockId, {
      transcript_id: result.id,
      ...(language ? { transcript_language: language } : {}),
      ...(!currentData.summary_language && language ? { summary_language: language } : {}),
      recording_state: 'recorded',
      show_notes_directly: false,
      last_modified: new Date().toISOString(),
    });
  });
  return true;
}
