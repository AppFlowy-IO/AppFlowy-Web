import { Element, Node, Text } from 'slate';
import * as Y from 'yjs';

import { YjsEditor } from '@/application/slate-yjs';
import { traverseBlock } from '@/application/slate-yjs/utils/convert';
import { createBlock, initializeDocumentStructure } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YjsEditorKey, YSharedRoot } from '@/application/types';

import { extractMeetingSummarySources, formatMeetingSummarySources, parseSummaryReferences } from '../ai-meeting.references';
import { replaceBlockChildrenWithMarkdown } from '../ai-meeting.summary-regenerate';

const paragraph = (blockId: string, text: string, children: Element[] = []): Element => ({
  blockId, type: BlockType.Paragraph, data: {},
  children: [{ type: YjsEditorKey.text, children: [{ text }] }, ...children],
});
const section = (type: BlockType, children: Element[]): Element => ({ type, children });

function fixture() {
  const doc = new Y.Doc();

  initializeDocumentStructure(doc, false, 'references');
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const block = createBlock(sharedRoot, { ty: BlockType.AIMeetingSummaryBlock, data: {} });

  return { doc, sharedRoot, blockId: block.get(YjsEditorKey.block_id), editor: { sharedRoot } as YjsEditor };
}

function leaves(node: Node): Text[] {
  return Text.isText(node) ? [node] : node.children.flatMap(leaves);
}

describe('Flutter reference extraction', () => {
  it('identifies speaker paragraphs, plain transcripts, and nested notes without duplicating text', () => {
    const sources = extractMeetingSummarySources({
      transcriptNode: section(BlockType.AIMeetingTranscriptionBlock, [
        { blockId: 'speaker-container', type: BlockType.AIMeetingSpeakerBlock, data: { speaker_id: 'A' }, children: [paragraph('speech', 'Search is broken.')] },
        paragraph('plain', 'A transcript without diarization.'),
        paragraph('empty', '  '),
      ]),
      notesNode: section(BlockType.AIMeetingNotesBlock, [paragraph('note', 'Fix search.', [paragraph('nested', 'Check the shortcut.')])]),
      resolveSpeakerName: (id) => id === 'A' ? 'Annie' : 'Unknown speaker',
    });

    expect(sources.map((source) => source.blockId)).toEqual(['speech', 'plain', 'note', 'nested']);
    expect(formatMeetingSummarySources(sources)).toBe(
      'Transcript:\n[BLOCK:speech] Annie: Search is broken.\n[BLOCK:plain] A transcript without diarization.\n\nManual Notes:\n[BLOCK:note] Fix search.\n[BLOCK:nested] Check the shortcut.'
    );
  });
});

describe('Flutter ReferenceInlineSyntax and numbering, persisted in Yjs', () => {
  // These cover the native reference_inline_syntax_test.dart cases through the
  // actual web markdown-to-document path, including saved reference attributes.
  it.each([
    ['single reference', 'A sentence {ref:id1}.', [['id1', 1]]],
    ['comma-separated references', 'Multiple {ref:id1,id2,id3}.', [['id1', 1], ['id2', 2], ['id3', 3]]],
    ['repeated references across paragraphs', 'First {ref:id1}\n\nSecond {ref:id2}\n\nThird {ref:id1}', [['id1', 1], ['id2', 2], ['id1', 1]]],
    ['plain text', 'Text without references.', []],
    ['multiple markers in a paragraph', 'Start {ref:id1} middle {ref:id2} end.', [['id1', 1], ['id2', 2]]],
    ['empty marker', 'Empty {ref:} reference.', []],
    ['whitespace and duplicate IDs', 'Refs {ref: id1, id2, id1 }', [['id1', 1], ['id2', 2]]],
    ['sorting by existing number', 'First {ref:id1}\n\nThen {ref:id2,id1}', [['id1', 1], ['id1', 1], ['id2', 2]]],
    ['unrecognized source IDs', 'Fact {ref:invented,id1}', [['id1', 1]]],
  ])('converts %s to separate source buttons', (_name, markdown, expected) => {
    const { doc, editor, sharedRoot, blockId } = fixture();

    expect(replaceBlockChildrenWithMarkdown({ editor, blockId, markdown: markdown as string, referenceBlockIds: new Set(['id1', 'id2', 'id3']) })).toBe(true);
    const saved = leaves(traverseBlock(blockId, sharedRoot)!);
    const refs = saved.filter((leaf) => leaf.reference).map((leaf) => {
      expect(leaf.text).toBe('^');
      const reference = leaf.reference as { blockIds: string[]; number: number };

      expect(reference.blockIds).toHaveLength(1);
      return [reference.blockIds[0], reference.number];
    });

    expect(refs).toEqual(expected);
    if ((expected as unknown[]).length) expect(saved.map((leaf) => leaf.text).join('')).not.toContain('{ref:');
    doc.destroy();
  });

  it('keeps literal syntax when reference processing is not enabled', () => {
    const { doc, editor, sharedRoot, blockId } = fixture();

    replaceBlockChildrenWithMarkdown({ editor, blockId, markdown: 'Text {ref:id1}.' });
    expect(Node.string(traverseBlock(blockId, sharedRoot)!)).toBe('Text {ref:id1}.');
    doc.destroy();
  });

  it('saves Context as a separate nested bullet with independent formatting and source references', () => {
    const { doc, editor, sharedRoot, blockId } = fixture();

    replaceBlockChildrenWithMarkdown({
      editor, blockId,
      markdown: '- **Key point:** Some credit spreads rise. {ref:id1}\n  - **Context:** Conference growth. {ref:id2}\n- Next step {ref:id1}',
      referenceBlockIds: new Set(['id1', 'id2']),
    });
    const summary = traverseBlock(blockId, sharedRoot)!;
    const [parent, sibling] = summary.children.filter(Element.isElement);
    const [parentText, context] = parent.children.filter(Element.isElement);

    expect(parent.type).toBe(BlockType.BulletedListBlock);
    expect(Node.string(parentText)).toBe('Key point: Some credit spreads rise. ^');
    expect(context.type).toBe(BlockType.BulletedListBlock);
    expect(Node.string(context)).toBe('Context: Conference growth. ^');
    expect(leaves(context).find((leaf) => leaf.text === 'Context:')?.bold).toBe(true);
    expect(leaves(parentText).find((leaf) => leaf.reference)?.reference).toEqual({ blockIds: ['id1'], number: 1 });
    expect(leaves(context).find((leaf) => leaf.reference)?.reference).toEqual({ blockIds: ['id2'], number: 2 });
    expect(leaves(sibling).find((leaf) => leaf.reference)?.reference).toEqual({ blockIds: ['id1'], number: 1 });
    doc.destroy();
  });

  it('persists Overview paragraph breaks, emphasized meeting type and the trailing citation without joining sentences', () => {
    const { doc, editor, sharedRoot, blockId } = fixture();

    replaceBlockChildrenWithMarkdown({
      editor, blockId,
      markdown: '## Overview\n\nThe interview covers fiscal policy.  \nAttendees include Jamie Dimon. The session is an **executive interview / fireside chat**. {ref:id1}',
      referenceBlockIds: new Set(['id1']),
    });
    const [heading, paragraph] = traverseBlock(blockId, sharedRoot)!.children.filter(Element.isElement);

    expect(heading.type).toBe(BlockType.HeadingBlock);
    expect(Node.string(heading)).toBe('Overview');
    expect(Node.string(paragraph)).toBe('The interview covers fiscal policy.\nAttendees include Jamie Dimon. The session is an executive interview / fireside chat. ^');
    expect(leaves(paragraph).find((leaf) => leaf.text === 'executive interview / fireside chat')?.bold).toBe(true);
    expect(leaves(paragraph).at(-1)?.reference).toEqual({ blockIds: ['id1'], number: 1 });
    const reopened = new Y.Doc();

    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
    expect(traverseBlock(blockId, reopened.getMap(YjsEditorKey.data_section) as YSharedRoot)).toEqual(traverseBlock(blockId, sharedRoot));
    reopened.destroy();
    doc.destroy();
  });

  it('starts numbering at one for each regenerated summary and preserves rich text around markers', () => {
    const { doc, editor, sharedRoot, blockId } = fixture();

    replaceBlockChildrenWithMarkdown({ editor, blockId, markdown: 'First {ref:id1,id2}', referenceBlockIds: new Set(['id1', 'id2']) });
    replaceBlockChildrenWithMarkdown({ editor, blockId, markdown: '**Important** {ref:id2}', referenceBlockIds: new Set(['id1', 'id2']) });
    const saved = leaves(traverseBlock(blockId, sharedRoot)!);

    expect(saved.find((leaf) => leaf.text === 'Important')?.bold).toBe(true);
    expect(saved.find((leaf) => leaf.reference)?.reference).toEqual({ blockIds: ['id2'], number: 1 });
    doc.destroy();
  });

  it('parses a marker spanning formatting boundaries and keeps surrounding marks', () => {
    const counter = new Map<string, number>();
    const result = parseSummaryReferences([{ text: 'Before {re', bold: true }, { text: 'f:id1} after', italic: true }], new Set(['id1']), counter);

    expect(result).toEqual([{ text: 'Before ', bold: true }, { text: '^', reference: { blockIds: ['id1'], number: 1 } }, { text: ' after', italic: true }]);
  });
});
