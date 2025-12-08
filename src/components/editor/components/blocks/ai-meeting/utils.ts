import { nanoid } from 'nanoid';
import { Editor, Element, Node, Text, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import {
  createBlock,
  deleteBlock as deleteYjsBlock,
  getBlock,
  getChildrenArray,
  getText,
  updateBlockParent,
} from '@/application/slate-yjs/utils/yjs';
import { BlockType, YjsEditorKey } from '@/application/types';
import {
  AIMeetingNode,
  AIMeetingSummaryNode,
  AIMeetingTranscriptionNode,
  ParagraphNode,
  SpeakerNode,
} from '@/components/editor/editor.type';

import { TranscriptionResult, TranscriptionSegment } from './services/types';

/**
 * Find the parent AI Meeting node from any child node within the meeting block
 */
export function findParentAIMeetingNode(
  editor: Editor,
  node: Element
): AIMeetingNode | null {
  try {
    const path = ReactEditor.findPath(editor as ReactEditor, node);
    const match = Editor.above(editor, {
      match: (n) => {
        return (
          !Editor.isEditor(n) &&
          Element.isElement(n) &&
          n.type === BlockType.AIMeetingBlock
        );
      },
      at: path,
    });

    if (match) {
      return match[0] as AIMeetingNode;
    }

    return null;
  } catch (e) {
    console.error('[AI Meeting] Error finding parent meeting node:', e);
    return null;
  }
}

/**
 * Update the data attribute of a node
 */
export function updateNodeData<T extends Element>(
  editor: Editor,
  node: T,
  newData: Partial<T['data']>
): void {
  try {
    const path = ReactEditor.findPath(editor as ReactEditor, node);
    const currentData = (node as Element & { data?: object }).data || {};

    Transforms.setNodes(
      editor,
      { data: { ...currentData, ...newData } },
      { at: path }
    );
  } catch (e) {
    console.error('[AI Meeting] Error updating node data:', e);
  }
}

/**
 * Update the title of an AI Meeting block
 */
export function updateMeetingTitle(
  editor: Editor,
  meetingNode: AIMeetingNode,
  newTitle: string
): void {
  const trimmedTitle = newTitle.trim();

  if (!trimmedTitle) return; // Don't allow empty titles

  updateNodeData(editor, meetingNode, {
    title: trimmedTitle,
    last_modified: new Date().toISOString(),
  });
}

/**
 * Update a speaker's name in the parent AI Meeting node's speaker_name_map
 */
export function updateSpeakerName(
  editor: Editor,
  meetingNode: AIMeetingNode,
  speakerId: string,
  newName: string
): void {
  const trimmedName = newName.trim();

  if (!trimmedName) return; // Don't allow empty names

  const currentMap = meetingNode.data?.speaker_name_map || {};
  const updatedMap = {
    ...currentMap,
    [speakerId]: trimmedName,
  };

  updateNodeData(editor, meetingNode, {
    speaker_name_map: updatedMap,
    last_modified: new Date().toISOString(),
  });
}

/**
 * Get the display name for a speaker
 * Resolution order:
 * 1. Parent AI Meeting node's speaker_name_map[speaker_id]
 * 2. Fallback: "Speaker {speaker_id}"
 */
export function getSpeakerDisplayName(
  meetingNode: AIMeetingNode | null,
  speakerId?: string
): string {
  if (!speakerId) return 'Speaker A';

  if (meetingNode) {
    const nameMap = meetingNode.data?.speaker_name_map || {};
    const mappedName = nameMap[speakerId];

    if (mappedName && mappedName.trim()) {
      return mappedName;
    }
  }

  return `Speaker ${speakerId}`;
}

/**
 * Extract text from a node and its children
 */
function extractTextFromNode(node: Node): string {
  if (Text.isText(node)) {
    return node.text;
  }

  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map(extractTextFromNode).join('\n');
  }

  return '';
}

/**
 * Extract content from meeting node (transcript + notes) for summarization
 * Format matches Flutter implementation:
 * - "Transcript: {content}"
 * - "Manual Notes: {content}"
 */
export function extractMeetingContent(meetingNode: AIMeetingNode): string {
  const children = meetingNode.children || [];
  const parts: string[] = [];

  // Find and extract transcript content
  const transcriptionNode = children.find(
    (child): child is AIMeetingTranscriptionNode =>
      Element.isElement(child) && child.type === BlockType.AIMeetingTranscription
  );

  if (transcriptionNode && transcriptionNode.children) {
    const transcriptParts: string[] = [];

    for (const child of transcriptionNode.children) {
      if (Element.isElement(child) && child.type === BlockType.SpeakerBlock) {
        const speakerNode = child as SpeakerNode;
        const speakerId = speakerNode.data?.speaker_id || 'A';
        const speakerName = getSpeakerDisplayName(meetingNode, speakerId);
        const text = extractTextFromNode(speakerNode);

        if (text.trim()) {
          transcriptParts.push(`${speakerName}: ${text.trim()}`);
        }
      } else if (Element.isElement(child)) {
        const text = extractTextFromNode(child);

        if (text.trim()) {
          transcriptParts.push(text.trim());
        }
      }
    }

    if (transcriptParts.length > 0) {
      // Match Flutter format: "Transcript: {content}"
      parts.push('Transcript: ' + transcriptParts.join('\n'));
    }
  }

  // Find and extract notes content
  const notesNode = children.find(
    (child) => Element.isElement(child) && child.type === BlockType.AIMeetingNotes
  );

  if (notesNode && 'children' in notesNode) {
    const notesText = extractTextFromNode(notesNode as Node);

    if (notesText.trim()) {
      // Match Flutter format: "Manual Notes: {content}"
      parts.push('Manual Notes: ' + notesText.trim());
    }
  }

  return parts.join('\n\n');
}

/**
 * Create a paragraph node with text content
 */
function _createParagraphNode(text: string): ParagraphNode {
  return {
    type: BlockType.Paragraph,
    blockId: nanoid(8),
    children: [{ text }],
    data: {},
  };
}

/**
 * Update summary content from streamed text using YJS operations directly.
 * This ensures the content is properly synced to YJS so that delete/edit operations work.
 * Matches Flutter behavior: clears content on first update, then streams progressively.
 *
 * @param editor - Slate editor instance (must be a YjsEditor)
 * @param meetingNode - The AI Meeting node
 * @param content - The text content to display
 * @param done - Whether streaming is complete (triggers final formatting)
 */
export function updateSummaryContent(
  editor: Editor,
  meetingNode: AIMeetingNode,
  content: string,
  done: boolean = false
): void {
  // Check if editor is a YjsEditor
  if (!YjsEditor.isYjsEditor(editor)) {
    return;
  }

  const children = meetingNode.children || [];

  // Find summary node
  const summaryNode = children.find(
    (child): child is AIMeetingSummaryNode =>
      Element.isElement(child) && child.type === BlockType.AIMeetingSummary
  );

  if (!summaryNode || !summaryNode.blockId) {
    console.warn('[AI Meeting] No summary node found or missing blockId');
    return;
  }

  try {
    const sharedRoot = editor.sharedRoot;
    const summaryBlock = getBlock(summaryNode.blockId, sharedRoot);

    if (!summaryBlock) {
      console.warn('[AI Meeting] Summary block not found in YJS');
      return;
    }

    // Get existing children from YJS
    const summaryChildrenId = summaryBlock.get(YjsEditorKey.block_children);
    const existingChildren = getChildrenArray(summaryChildrenId, sharedRoot);
    const existingChildIds = existingChildren?.toArray() || [];

    // Determine paragraphs to create
    const paragraphTexts = done
      ? content.split('\n\n').filter((p) => p.trim()).map((p) => p.trim())
      : [content || ''];

    // If no content, still create at least one empty paragraph
    if (paragraphTexts.length === 0) {
      paragraphTexts.push('');
    }

    // Use YJS transaction to update content atomically
    const doc = sharedRoot.doc;

    if (!doc) {
      console.warn('[AI Meeting] YDoc not found');
      return;
    }

    doc.transact(() => {
      // Delete all existing children from YJS
      existingChildIds.forEach((childId) => {
        deleteYjsBlock(sharedRoot, childId);
      });

      // Create new paragraph blocks in YJS
      paragraphTexts.forEach((text, index) => {
        const paragraphBlock = createBlock(sharedRoot, {
          ty: BlockType.Paragraph,
          data: {},
        });

        // Set the text content
        const textId = paragraphBlock.get(YjsEditorKey.block_external_id);
        const yText = getText(textId, sharedRoot);

        if (yText && text) {
          yText.insert(0, text);
        }

        // Add paragraph as child of summary
        updateBlockParent(sharedRoot, paragraphBlock, summaryBlock, index);
      });
    });
  } catch (e) {
    console.error('[AI Meeting] Error updating summary content:', e);
  }
}

/**
 * Create a speaker node from a transcription segment
 */
function _createSpeakerNode(segment: TranscriptionSegment): SpeakerNode {
  return {
    type: BlockType.SpeakerBlock,
    blockId: nanoid(8),
    children: [{ text: segment.text.trim() }],
    data: {
      delta: [{ insert: segment.text.trim(), attributes: {} }],
      speaker_id: segment.speaker || 'A',
      speaker_name: `Speaker ${segment.speaker || 'A'}`,
      timestamp: segment.start,
    },
  };
}

/**
 * Create notes content for "New AI meeting notes" action using YJS operations directly.
 * This ensures the content is properly synced to YJS so that delete/edit operations work.
 */
export function createNotesContent(
  editor: Editor,
  meetingNode: AIMeetingNode
): void {
  // Check if editor is a YjsEditor
  if (!YjsEditor.isYjsEditor(editor)) {
    return;
  }

  const children = meetingNode.children || [];

  // Find notes node
  const notesNode = children.find(
    (child) => Element.isElement(child) && child.type === BlockType.AIMeetingNotes
  );

  if (!notesNode || !Element.isElement(notesNode) || !notesNode.blockId) {
    console.warn('[AI Meeting] No notes node found or missing blockId');
    return;
  }

  try {
    const sharedRoot = editor.sharedRoot;
    const notesBlock = getBlock(notesNode.blockId, sharedRoot);

    if (!notesBlock) {
      console.warn('[AI Meeting] Notes block not found in YJS');
      return;
    }

    // Use YJS transaction to create content atomically
    const doc = sharedRoot.doc;

    if (!doc) {
      console.warn('[AI Meeting] YDoc not found');
      return;
    }

    doc.transact(() => {
      // Create an empty paragraph block for the user to start typing
      const paragraphBlock = createBlock(sharedRoot, {
        ty: BlockType.Paragraph,
        data: {},
      });

      // Add paragraph as first child of notes
      updateBlockParent(sharedRoot, paragraphBlock, notesBlock, 0);
    });
  } catch (e) {
    console.error('[AI Meeting] Error creating notes content:', e);
  }
}

/**
 * Create speaker nodes from transcription result and update the transcription node using YJS operations directly.
 * This ensures the content is properly synced to YJS so that delete/edit operations work.
 */
export function createSpeakerNodesFromTranscription(
  editor: Editor,
  meetingNode: AIMeetingNode,
  result: TranscriptionResult
): void {
  // Check if editor is a YjsEditor
  if (!YjsEditor.isYjsEditor(editor)) {
    return;
  }

  const children = meetingNode.children || [];

  // Find transcription node
  const transcriptionNode = children.find(
    (child): child is AIMeetingTranscriptionNode =>
      Element.isElement(child) && child.type === BlockType.AIMeetingTranscription
  );

  if (!transcriptionNode || !transcriptionNode.blockId) {
    console.warn('[AI Meeting] No transcription node found or missing blockId');
    return;
  }

  try {
    const sharedRoot = editor.sharedRoot;
    const transcriptionBlock = getBlock(transcriptionNode.blockId, sharedRoot);

    if (!transcriptionBlock) {
      console.warn('[AI Meeting] Transcription block not found in YJS');
      return;
    }

    // Get existing children from YJS
    const transcriptionChildrenId = transcriptionBlock.get(YjsEditorKey.block_children);
    const existingChildren = getChildrenArray(transcriptionChildrenId, sharedRoot);
    const existingChildIds = existingChildren?.toArray() || [];

    // Use YJS transaction to update content atomically
    const doc = sharedRoot.doc;

    if (!doc) {
      console.warn('[AI Meeting] YDoc not found');
      return;
    }

    doc.transact(() => {
      // Delete all existing children from YJS
      existingChildIds.forEach((childId) => {
        deleteYjsBlock(sharedRoot, childId);
      });

      // Create new blocks in YJS
      if (result.segments && result.segments.length > 0) {
        // Create speaker blocks
        result.segments.forEach((segment, index) => {
          const speakerBlock = createBlock(sharedRoot, {
            ty: BlockType.SpeakerBlock,
            data: {
              delta: [{ insert: segment.text.trim(), attributes: {} }],
              speaker_id: segment.speaker || 'A',
              speaker_name: `Speaker ${segment.speaker || 'A'}`,
              timestamp: segment.start,
            },
          });

          // Set the text content
          const textId = speakerBlock.get(YjsEditorKey.block_external_id);
          const yText = getText(textId, sharedRoot);

          if (yText) {
            yText.insert(0, segment.text.trim());
          }

          // Add speaker block as child of transcription
          updateBlockParent(sharedRoot, speakerBlock, transcriptionBlock, index);
        });
      } else {
        // Fallback: create a single paragraph with the full text
        const paragraphBlock = createBlock(sharedRoot, {
          ty: BlockType.Paragraph,
          data: {},
        });

        // Set the text content
        const textId = paragraphBlock.get(YjsEditorKey.block_external_id);
        const yText = getText(textId, sharedRoot);

        if (yText && result.text) {
          yText.insert(0, result.text);
        }

        // Add paragraph as child of transcription
        updateBlockParent(sharedRoot, paragraphBlock, transcriptionBlock, 0);
      }
    });

    // Update speaker name map if we have speaker IDs
    if (result.segments && result.segments.length > 0) {
      const speakerIds = new Set(result.segments.map((s) => s.speaker).filter(Boolean));
      const currentMap = meetingNode.data?.speaker_name_map || {};
      const updatedMap = { ...currentMap };

      // Only add new speakers that aren't already in the map
      speakerIds.forEach((id) => {
        if (id && !updatedMap[id]) {
          updatedMap[id] = `Speaker ${id}`;
        }
      });

      // Update meeting node with new speaker map if changed
      if (Object.keys(updatedMap).length > Object.keys(currentMap).length) {
        updateNodeData(editor, meetingNode, {
          speaker_name_map: updatedMap,
        });
      }
    }
  } catch (e) {
    console.error('[AI Meeting] Error creating speaker nodes from transcription:', e);
  }
}
