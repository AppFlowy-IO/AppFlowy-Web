import { expect, describe, it } from '@jest/globals';
import { Element, Node, Text } from 'slate';

import { BlockType } from '@/application/types';

/**
 * Test helpers - replicating the logic from InlineReference.tsx
 */

type ReferenceSourceType = 'transcript' | 'notes';

interface ReferenceBlockStatus {
  blockId: string;
  status: 'exists' | 'deleted';
  content?: string;
  sourceType?: ReferenceSourceType;
  timestamp?: number;
}

const normalizeTimestamp = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
};

const buildContent = (node: Node) => {
  const getBlockTextContent = (n: Node): string => {
    if (Text.isText(n)) return n.text;
    if (Element.isElement(n)) {
      return n.children.map((child) => getBlockTextContent(child)).join('');
    }

    return '';
  };

  return getBlockTextContent(node).trim();
};

const findInChildren = (
  node: Node,
  blockId: string,
  sourceType: ReferenceSourceType,
  timestamp?: number
): ReferenceBlockStatus | null => {
  if (!Element.isElement(node)) return null;

  for (const child of node.children) {
    if (!Element.isElement(child)) continue;

    if (child.blockId === blockId) {
      return {
        blockId,
        status: 'exists',
        content: buildContent(child),
        sourceType,
        timestamp,
      };
    }

    const nested = findInChildren(child, blockId, sourceType, timestamp);

    if (nested) return nested;
  }

  return null;
};

const findInTranscript = (node: Element, blockId: string): ReferenceBlockStatus | null => {
  for (const child of node.children) {
    if (!Element.isElement(child)) continue;

    if (child.type === BlockType.AIMeetingSpeakerBlock) {
      const timestamp = normalizeTimestamp((child.data as Record<string, unknown> | undefined)?.timestamp);
      const found = findInChildren(child, blockId, 'transcript', timestamp);

      if (found) return found;
      continue;
    }

    if (child.blockId === blockId) {
      return {
        blockId,
        status: 'exists',
        content: buildContent(child),
        sourceType: 'transcript',
      };
    }

    const nested = findInChildren(child, blockId, 'transcript');

    if (nested) return nested;
  }

  return null;
};

const findInNotes = (node: Element, blockId: string): ReferenceBlockStatus | null => {
  for (const child of node.children) {
    if (!Element.isElement(child)) continue;

    if (child.blockId === blockId) {
      return {
        blockId,
        status: 'exists',
        content: buildContent(child),
        sourceType: 'notes',
      };
    }

    const nested = findInChildren(child, blockId, 'notes');

    if (nested) return nested;
  }

  return null;
};

const buildStatuses = (meetingNode: Element, blockIds: string[]): ReferenceBlockStatus[] => {
  const transcriptionNode = meetingNode.children.find(
    (child) => Element.isElement(child) && child.type === BlockType.AIMeetingTranscriptionBlock
  ) as Element | undefined;
  const notesNode = meetingNode.children.find(
    (child) => Element.isElement(child) && child.type === BlockType.AIMeetingNotesBlock
  ) as Element | undefined;

  return blockIds.map((blockId) => {
    if (transcriptionNode) {
      const found = findInTranscript(transcriptionNode, blockId);

      if (found) return found;
    }

    if (notesNode) {
      const found = findInNotes(notesNode, blockId);

      if (found) return found;
    }

    return {
      blockId,
      status: 'deleted',
    };
  });
};

const getAvailableTabs = (meetingNode: Element) => {
  const children = meetingNode.children ?? [];
  const summaryNode = children.find(
    (child) => Element.isElement(child) && child.type === BlockType.AIMeetingSummaryBlock
  ) as Element | undefined;
  const transcriptNode = children.find(
    (child) => Element.isElement(child) && child.type === BlockType.AIMeetingTranscriptionBlock
  ) as Element | undefined;

  const tabs: Array<'summary' | 'notes' | 'transcript'> = [];

  if (summaryNode && buildContent(summaryNode).length > 0) {
    tabs.push('summary');
  }

  tabs.push('notes');

  if (transcriptNode && buildContent(transcriptNode).length > 0) {
    tabs.push('transcript');
  }

  return tabs;
};

/**
 * Mock data factories
 */
const createTextNode = (text: string): Element =>
  ({
    type: 'text',
    children: [{ text }],
  }) as unknown as Element;

const createParagraphNode = (text: string, blockId: string): Element =>
  ({
    type: BlockType.Paragraph,
    blockId,
    children: [createTextNode(text)],
  }) as unknown as Element;

const createSpeakerNode = (
  speakerId: string,
  timestamp: number,
  children: Element[],
  blockIdSuffix = ''
): Element =>
  ({
    type: BlockType.AIMeetingSpeakerBlock,
    blockId: `speaker-${speakerId}${blockIdSuffix}`,
    data: { speaker_id: speakerId, timestamp },
    children,
  }) as unknown as Element;

const createSectionNode = (type: BlockType, children: Element[], blockId?: string): Element =>
  ({
    type,
    blockId: blockId ?? `section-${type}`,
    children,
  }) as unknown as Element;

const createMeetingNode = (sections: Element[]): Element =>
  ({
    type: BlockType.AIMeetingBlock,
    blockId: 'meeting-1',
    data: {},
    children: sections,
  }) as unknown as Element;

describe('InlineReference Logic', () => {
  describe('normalizeTimestamp', () => {
    it('should return number if already a valid number', () => {
      expect(normalizeTimestamp(123)).toBe(123);
      expect(normalizeTimestamp(0)).toBe(0);
      expect(normalizeTimestamp(45.5)).toBe(45.5);
    });

    it('should parse valid numeric strings', () => {
      expect(normalizeTimestamp('123')).toBe(123);
      expect(normalizeTimestamp('45.5')).toBe(45.5);
      expect(normalizeTimestamp('0')).toBe(0);
    });

    it('should return undefined for invalid inputs', () => {
      expect(normalizeTimestamp(undefined)).toBeUndefined();
      expect(normalizeTimestamp(null)).toBeUndefined();
      expect(normalizeTimestamp(NaN)).toBeUndefined();
      expect(normalizeTimestamp(Infinity)).toBeUndefined();
      expect(normalizeTimestamp('')).toBeUndefined();
      expect(normalizeTimestamp('   ')).toBeUndefined();
      expect(normalizeTimestamp('not a number')).toBeUndefined();
    });
  });

  describe('buildContent', () => {
    it('should extract text from text node', () => {
      const node = { text: 'Hello world' } as unknown as Node;

      expect(buildContent(node)).toBe('Hello world');
    });

    it('should extract text from nested element', () => {
      const node = createParagraphNode('Nested text', 'p1');

      expect(buildContent(node)).toBe('Nested text');
    });

    it('should trim whitespace', () => {
      const node = createParagraphNode('  padded text  ', 'p1');

      expect(buildContent(node)).toBe('padded text');
    });

    it('should concatenate multiple text nodes', () => {
      const node = {
        type: BlockType.Paragraph,
        children: [{ text: 'Hello ' }, { text: 'world' }],
      } as unknown as Element;

      expect(buildContent(node)).toBe('Hello world');
    });
  });

  describe('findInTranscript', () => {
    it('should find block inside speaker block with timestamp', () => {
      const paragraphBlock = createParagraphNode('Speaker message', 'para-1');
      const speakerBlock = createSpeakerNode('s1', 120, [paragraphBlock]);
      const transcriptSection = createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
        speakerBlock,
      ]);

      const result = findInTranscript(transcriptSection, 'para-1');

      expect(result).not.toBeNull();
      expect(result?.status).toBe('exists');
      expect(result?.blockId).toBe('para-1');
      expect(result?.sourceType).toBe('transcript');
      expect(result?.timestamp).toBe(120);
      expect(result?.content).toBe('Speaker message');
    });

    it('should find block at transcript root level', () => {
      const paragraphBlock = createParagraphNode('Root message', 'para-root');
      const transcriptSection = createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
        paragraphBlock,
      ]);

      const result = findInTranscript(transcriptSection, 'para-root');

      expect(result?.status).toBe('exists');
      expect(result?.sourceType).toBe('transcript');
      expect(result?.timestamp).toBeUndefined();
    });

    it('should return null if block not found', () => {
      const transcriptSection = createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
        createSpeakerNode('s1', 0, [createParagraphNode('Message', 'para-1')]),
      ]);

      const result = findInTranscript(transcriptSection, 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findInNotes', () => {
    it('should find block in notes section', () => {
      const notesSection = createSectionNode(BlockType.AIMeetingNotesBlock, [
        createParagraphNode('Note 1', 'note-1'),
        createParagraphNode('Note 2', 'note-2'),
      ]);

      const result = findInNotes(notesSection, 'note-2');

      expect(result).not.toBeNull();
      expect(result?.status).toBe('exists');
      expect(result?.blockId).toBe('note-2');
      expect(result?.sourceType).toBe('notes');
      expect(result?.content).toBe('Note 2');
    });

    it('should find deeply nested block', () => {
      const nestedBlock = createParagraphNode('Nested note', 'nested-1');
      const containerBlock = {
        type: BlockType.BulletedListBlock,
        blockId: 'list-1',
        children: [nestedBlock],
      } as unknown as Element;
      const notesSection = createSectionNode(BlockType.AIMeetingNotesBlock, [containerBlock]);

      const result = findInNotes(notesSection, 'nested-1');

      expect(result?.status).toBe('exists');
      expect(result?.content).toBe('Nested note');
    });

    it('should return null if block not found', () => {
      const notesSection = createSectionNode(BlockType.AIMeetingNotesBlock, [
        createParagraphNode('Note 1', 'note-1'),
      ]);

      const result = findInNotes(notesSection, 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('buildStatuses', () => {
    it('should return statuses for all requested block ids', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingNotesBlock, [
          createParagraphNode('Note 1', 'note-1'),
          createParagraphNode('Note 2', 'note-2'),
        ]),
      ]);

      const statuses = buildStatuses(meetingNode, ['note-1', 'note-2']);

      expect(statuses).toHaveLength(2);
      expect(statuses[0].blockId).toBe('note-1');
      expect(statuses[0].status).toBe('exists');
      expect(statuses[1].blockId).toBe('note-2');
      expect(statuses[1].status).toBe('exists');
    });

    it('should mark missing blocks as deleted', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingNotesBlock, [
          createParagraphNode('Note 1', 'note-1'),
        ]),
      ]);

      const statuses = buildStatuses(meetingNode, ['note-1', 'deleted-block']);

      expect(statuses[0].status).toBe('exists');
      expect(statuses[1].status).toBe('deleted');
      expect(statuses[1].blockId).toBe('deleted-block');
    });

    it('should search transcript before notes', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
          createSpeakerNode('s1', 60, [createParagraphNode('Transcript text', 'block-1')]),
        ]),
        createSectionNode(BlockType.AIMeetingNotesBlock, [
          createParagraphNode('Note text', 'block-2'),
        ]),
      ]);

      const statuses = buildStatuses(meetingNode, ['block-1', 'block-2']);

      expect(statuses[0].sourceType).toBe('transcript');
      expect(statuses[0].timestamp).toBe(60);
      expect(statuses[1].sourceType).toBe('notes');
    });

    it('should handle empty block ids array', () => {
      const meetingNode = createMeetingNode([]);

      const statuses = buildStatuses(meetingNode, []);

      expect(statuses).toEqual([]);
    });

    it('should handle meeting with no sections', () => {
      const meetingNode = createMeetingNode([]);

      const statuses = buildStatuses(meetingNode, ['block-1']);

      expect(statuses[0].status).toBe('deleted');
    });
  });

  describe('getAvailableTabs', () => {
    it('should always include notes tab', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingNotesBlock, []),
      ]);

      const tabs = getAvailableTabs(meetingNode);

      expect(tabs).toContain('notes');
    });

    it('should include summary only if it has content', () => {
      const meetingWithEmptySummary = createMeetingNode([
        createSectionNode(BlockType.AIMeetingSummaryBlock, []),
        createSectionNode(BlockType.AIMeetingNotesBlock, []),
      ]);

      expect(getAvailableTabs(meetingWithEmptySummary)).not.toContain('summary');

      const meetingWithSummary = createMeetingNode([
        createSectionNode(BlockType.AIMeetingSummaryBlock, [
          createParagraphNode('Summary content', 'sum-1'),
        ]),
        createSectionNode(BlockType.AIMeetingNotesBlock, []),
      ]);

      expect(getAvailableTabs(meetingWithSummary)).toContain('summary');
    });

    it('should include transcript only if it has content', () => {
      const meetingWithEmptyTranscript = createMeetingNode([
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, []),
        createSectionNode(BlockType.AIMeetingNotesBlock, []),
      ]);

      expect(getAvailableTabs(meetingWithEmptyTranscript)).not.toContain('transcript');

      const meetingWithTranscript = createMeetingNode([
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
          createSpeakerNode('s1', 0, [createParagraphNode('Transcript', 't-1')]),
        ]),
        createSectionNode(BlockType.AIMeetingNotesBlock, []),
      ]);

      expect(getAvailableTabs(meetingWithTranscript)).toContain('transcript');
    });

    it('should return tabs in correct order', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingSummaryBlock, [
          createParagraphNode('Summary', 'sum-1'),
        ]),
        createSectionNode(BlockType.AIMeetingNotesBlock, [
          createParagraphNode('Notes', 'note-1'),
        ]),
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
          createSpeakerNode('s1', 0, [createParagraphNode('Transcript', 't-1')]),
        ]),
      ]);

      const tabs = getAvailableTabs(meetingNode);

      expect(tabs).toEqual(['summary', 'notes', 'transcript']);
    });
  });
});

describe('Reference Block Status Resolution', () => {
  it('should correctly identify existing vs deleted references', () => {
    const meetingNode = createMeetingNode([
      createSectionNode(BlockType.AIMeetingNotesBlock, [
        createParagraphNode('Existing note', 'existing-1'),
        createParagraphNode('Another note', 'existing-2'),
      ]),
    ]);

    const statuses = buildStatuses(meetingNode, ['existing-1', 'deleted-ref', 'existing-2']);

    expect(statuses[0].status).toBe('exists');
    expect(statuses[1].status).toBe('deleted');
    expect(statuses[2].status).toBe('exists');
  });

  it('should preserve timestamp from speaker block', () => {
    const meetingNode = createMeetingNode([
      createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
        createSpeakerNode('s1', 125, [createParagraphNode('Message at 2:05', 'msg-1')]),
        createSpeakerNode('s2', 180, [createParagraphNode('Message at 3:00', 'msg-2')]),
      ]),
    ]);

    const statuses = buildStatuses(meetingNode, ['msg-1', 'msg-2']);

    expect(statuses[0].timestamp).toBe(125);
    expect(statuses[1].timestamp).toBe(180);
  });

  it('should handle mixed sources (transcript and notes)', () => {
    const meetingNode = createMeetingNode([
      createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
        createSpeakerNode('s1', 60, [createParagraphNode('Transcript content', 'transcript-1')]),
      ]),
      createSectionNode(BlockType.AIMeetingNotesBlock, [
        createParagraphNode('Note content', 'note-1'),
      ]),
    ]);

    const statuses = buildStatuses(meetingNode, ['transcript-1', 'note-1']);

    expect(statuses[0].sourceType).toBe('transcript');
    expect(statuses[1].sourceType).toBe('notes');
  });
});

/**
 * Tab switching logic - replicating click handler behavior from InlineReference.tsx
 */

interface TabSwitchResult {
  targetTabKey: 'transcript' | 'notes';
  targetIndex: number;
  shouldSwitch: boolean;
}

const calculateTabSwitch = (
  meetingNode: Element,
  sourceType: ReferenceSourceType,
  currentTabIndex: number | string | undefined
): TabSwitchResult => {
  const tabs = getAvailableTabs(meetingNode);
  const targetKey: 'transcript' | 'notes' = sourceType === 'transcript' ? 'transcript' : 'notes';
  const targetIndex = Math.max(0, tabs.indexOf(targetKey));

  // Parse current index
  let currentIndex: number;

  if (typeof currentTabIndex === 'number') {
    currentIndex = currentTabIndex;
  } else if (typeof currentTabIndex === 'string') {
    currentIndex = Number(currentTabIndex);
  } else {
    currentIndex = NaN;
  }

  // Determine if switch is needed
  const shouldSwitch = Number.isNaN(currentIndex) ? true : currentIndex !== targetIndex;

  return {
    targetTabKey: targetKey,
    targetIndex,
    shouldSwitch,
  };
};

describe('Reference Click Tab Switching', () => {
  describe('calculateTabSwitch', () => {
    it('should switch to transcript tab when clicking transcript reference', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingSummaryBlock, [
          createParagraphNode('Summary', 'sum-1'),
        ]),
        createSectionNode(BlockType.AIMeetingNotesBlock, [
          createParagraphNode('Notes', 'note-1'),
        ]),
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
          createSpeakerNode('s1', 0, [createParagraphNode('Transcript', 't-1')]),
        ]),
      ]);

      // Currently on summary (index 0), clicking transcript reference
      const result = calculateTabSwitch(meetingNode, 'transcript', 0);

      expect(result.targetTabKey).toBe('transcript');
      expect(result.targetIndex).toBe(2); // [summary, notes, transcript] -> index 2
      expect(result.shouldSwitch).toBe(true);
    });

    it('should switch to notes tab when clicking notes reference', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingSummaryBlock, [
          createParagraphNode('Summary', 'sum-1'),
        ]),
        createSectionNode(BlockType.AIMeetingNotesBlock, [
          createParagraphNode('Notes', 'note-1'),
        ]),
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
          createSpeakerNode('s1', 0, [createParagraphNode('Transcript', 't-1')]),
        ]),
      ]);

      // Currently on transcript (index 2), clicking notes reference
      const result = calculateTabSwitch(meetingNode, 'notes', 2);

      expect(result.targetTabKey).toBe('notes');
      expect(result.targetIndex).toBe(1); // [summary, notes, transcript] -> index 1
      expect(result.shouldSwitch).toBe(true);
    });

    it('should not switch if already on target tab', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingNotesBlock, [
          createParagraphNode('Notes', 'note-1'),
        ]),
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
          createSpeakerNode('s1', 0, [createParagraphNode('Transcript', 't-1')]),
        ]),
      ]);

      // Currently on notes (index 0), clicking notes reference
      const result = calculateTabSwitch(meetingNode, 'notes', 0);

      expect(result.targetTabKey).toBe('notes');
      expect(result.targetIndex).toBe(0);
      expect(result.shouldSwitch).toBe(false);
    });

    it('should handle string tab index', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingNotesBlock, [
          createParagraphNode('Notes', 'note-1'),
        ]),
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
          createSpeakerNode('s1', 0, [createParagraphNode('Transcript', 't-1')]),
        ]),
      ]);

      // Current index passed as string "0"
      const result = calculateTabSwitch(meetingNode, 'transcript', '0');

      expect(result.shouldSwitch).toBe(true);
      expect(result.targetIndex).toBe(1);
    });

    it('should switch when current index is undefined', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingNotesBlock, [
          createParagraphNode('Notes', 'note-1'),
        ]),
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
          createSpeakerNode('s1', 0, [createParagraphNode('Transcript', 't-1')]),
        ]),
      ]);

      const result = calculateTabSwitch(meetingNode, 'transcript', undefined);

      expect(result.shouldSwitch).toBe(true);
    });

    it('should default to index 0 if target tab not in available tabs', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingNotesBlock, [
          createParagraphNode('Notes', 'note-1'),
        ]),
        // No transcript section
      ]);

      const result = calculateTabSwitch(meetingNode, 'transcript', 0);

      // Transcript not available, indexOf returns -1, Math.max(0, -1) = 0
      expect(result.targetIndex).toBe(0);
    });

    it('should handle meeting with only notes tab', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingNotesBlock, [
          createParagraphNode('Notes', 'note-1'),
        ]),
      ]);

      const result = calculateTabSwitch(meetingNode, 'notes', undefined);

      expect(result.targetTabKey).toBe('notes');
      expect(result.targetIndex).toBe(0);
      expect(result.shouldSwitch).toBe(true); // undefined -> NaN -> should switch
    });
  });

  describe('Tab index edge cases', () => {
    it('should correctly find transcript as last tab', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingSummaryBlock, [
          createParagraphNode('Summary', 'sum-1'),
        ]),
        createSectionNode(BlockType.AIMeetingNotesBlock, [
          createParagraphNode('Notes', 'note-1'),
        ]),
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
          createSpeakerNode('s1', 0, [createParagraphNode('Transcript', 't-1')]),
        ]),
      ]);

      const tabs = getAvailableTabs(meetingNode);

      expect(tabs).toEqual(['summary', 'notes', 'transcript']);
      expect(tabs.indexOf('transcript')).toBe(2);
    });

    it('should correctly find notes when no summary', () => {
      const meetingNode = createMeetingNode([
        createSectionNode(BlockType.AIMeetingNotesBlock, [
          createParagraphNode('Notes', 'note-1'),
        ]),
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
          createSpeakerNode('s1', 0, [createParagraphNode('Transcript', 't-1')]),
        ]),
      ]);

      const tabs = getAvailableTabs(meetingNode);

      expect(tabs).toEqual(['notes', 'transcript']);
      expect(tabs.indexOf('notes')).toBe(0);
      expect(tabs.indexOf('transcript')).toBe(1);
    });
  });
});
