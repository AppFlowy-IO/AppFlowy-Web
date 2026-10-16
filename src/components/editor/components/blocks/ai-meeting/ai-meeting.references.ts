import { Element, Node, Text } from 'slate';

import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType, YjsEditorKey } from '@/application/types';

export interface MeetingSummarySource {
  blockId: string;
  content: string;
  sourceType: 'transcript' | 'notes';
  speakerName?: string;
}

/** Flutter's ReferenceBlockExtractor uses paragraph IDs, not speaker container IDs. */
export function extractMeetingSummarySources({
  transcriptNode,
  notesNode,
  resolveSpeakerName,
}: {
  transcriptNode?: Node;
  notesNode?: Node;
  resolveSpeakerName: (speakerId?: string) => string;
}): MeetingSummarySource[] {
  const sources: MeetingSummarySource[] = [];
  const visit = (node: Node, sourceType: MeetingSummarySource['sourceType'], speakerName?: string) => {
    if (!Element.isElement(node) || node.type === YjsEditorKey.text) return;
    const data = node.data as Record<string, unknown> | undefined;
    const sourceSpeaker = node.type === BlockType.AIMeetingSpeakerBlock
      ? resolveSpeakerName((data?.speaker_id ?? data?.speakerId) as string | undefined)
      : speakerName;


    // Read only this block's text; nested blocks retain their own source IDs.
    const content = node.children
      .filter((child) => Text.isText(child) || (Element.isElement(child) && child.type === YjsEditorKey.text))
      .map((child) => CustomEditor.getBlockTextContent(child))
      .join('')
      .trim();

    if (node.blockId && content) sources.push({ blockId: node.blockId, content, sourceType, speakerName: sourceSpeaker });
    node.children.forEach((child) => visit(child, sourceType, sourceSpeaker));
  };

  if (transcriptNode && Element.isElement(transcriptNode)) transcriptNode.children.forEach((child) => visit(child, 'transcript'));
  if (notesNode && Element.isElement(notesNode)) notesNode.children.forEach((child) => visit(child, 'notes'));
  return sources;
}

export function formatMeetingSummarySources(sources: MeetingSummarySource[]) {
  return (['transcript', 'notes'] as const)
    .map((sourceType) => {
      const lines = sources.filter((source) => source.sourceType === sourceType).map((source) =>
        `[BLOCK:${source.blockId}] ${source.speakerName ? `${source.speakerName}: ` : ''}${source.content}`
      );

      return lines.length ? `${sourceType === 'transcript' ? 'Transcript' : 'Manual Notes'}:\n${lines.join('\n')}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Convert Flutter's {ref:id1,id2} syntax while retaining surrounding rich text. */
export function parseSummaryReferences(
  nodes: Text[],
  allowedBlockIds: ReadonlySet<string>,
  counter: Map<string, number>
): Text[] {
  const content = nodes.map((node) => node.text).join('');
  const result: Text[] = [];
  const copyRange = (from: number, to: number) => {
    let offset = 0;

    for (const node of nodes) {
      const start = Math.max(from - offset, 0);
      const end = Math.min(to - offset, node.text.length);

      if (end > start) result.push({ ...node, text: node.text.slice(start, end) });
      offset += node.text.length;
      if (offset >= to) break;
    }
  };

  let position = 0;

  for (const match of content.matchAll(/\{ref:([^}]+)\}/g)) {
    const start = match.index!;

    copyRange(position, start);
    const ids = [...new Set(match[1].split(',').map((id) => id.trim()).filter(Boolean))]
      .filter((id) => allowedBlockIds.has(id));

    ids.forEach((id) => { if (!counter.has(id)) counter.set(id, counter.size + 1); });
    ids.sort((a, b) => counter.get(a)! - counter.get(b)!);
    ids.forEach((id) => result.push({ text: '^', reference: { blockIds: [id], number: counter.get(id)! } } as Text));
    position = start + match[0].length;
  }

  if (position === 0) return nodes;
  copyRange(position, content.length);
  return result.length ? result : [{ text: '' }];
}
