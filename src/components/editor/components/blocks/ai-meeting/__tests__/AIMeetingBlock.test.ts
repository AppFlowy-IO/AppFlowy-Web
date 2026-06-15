import { expect, describe, it } from '@jest/globals';
import { Element, Node, Text } from 'slate';

import { BlockType } from '@/application/types';

/**
 * Test helpers - replicating the logic from AIMeetingBlock.tsx
 */

const hasNodeContent = (node?: Node) => {
  if (!node) return false;

  const getBlockTextContent = (n: Node): string => {
    if (Text.isText(n)) return n.text;
    if (Element.isElement(n)) {
      return n.children.map((child) => getBlockTextContent(child)).join('');
    }

    return '';
  };

  const text = getBlockTextContent(node).trim();

  return text.length > 0;
};

const parseSpeakerInfoMap = (raw: unknown) => {
  if (!raw) return null;

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;

      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return null;
    }
  }

  if (typeof raw === 'object') {
    return raw as Record<string, Record<string, unknown>>;
  }

  return null;
};

const getBaseSpeakerId = (speakerId: string) => {
  const [base] = speakerId.split('_');

  return base || speakerId;
};

const resolveSpeakerName = (
  speakerId: string | undefined,
  speakerInfoMap: Record<string, Record<string, unknown>> | null,
  unknownLabel: string,
  getFallbackLabel: (id: string) => string
) => {
  if (!speakerId) return unknownLabel;

  const baseId = getBaseSpeakerId(speakerId);
  const info = speakerInfoMap?.[speakerId] ?? speakerInfoMap?.[baseId];
  const name = typeof info?.name === 'string' ? info?.name?.trim() : '';

  if (name) return name;

  return getFallbackLabel(baseId);
};

const cloneNode = <T extends Node>(node: T): T => {
  return JSON.parse(JSON.stringify(node)) as T;
};

const insertSpeakerPrefix = (node: Node, speakerName: string): Node => {
  if (!Element.isElement(node)) return node;

  const cloned = cloneNode(node);
  const prefix = `${speakerName}: `;

  const insertIntoChildren = (children: Node[]): boolean => {
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];

      if (Text.isText(child)) {
        children.splice(index, 0, { text: prefix, bold: true });
        return true;
      }

      if (Element.isElement(child)) {
        const inserted = insertIntoChildren(child.children as Node[]);

        if (inserted) return true;
      }
    }

    return false;
  };

  insertIntoChildren(cloned.children as Node[]);

  return cloned;
};

const buildCopyText = (node?: Node) => {
  if (!node || !Element.isElement(node)) return '';

  const getBlockTextContent = (n: Node): string => {
    if (Text.isText(n)) return n.text;
    if (Element.isElement(n)) {
      return n.children.map((child) => getBlockTextContent(child)).join('');
    }

    return '';
  };

  const lines = node.children
    .map((child) => getBlockTextContent(child).trim())
    .filter((line) => line.length > 0);

  if (lines.length) return lines.join('\n');

  return getBlockTextContent(node).trim();
};

type TabKey = 'summary' | 'notes' | 'transcript';

interface TabDef {
  key: TabKey;
  type: BlockType;
}

const TAB_DEFS: TabDef[] = [
  { key: 'summary', type: BlockType.AIMeetingSummaryBlock },
  { key: 'notes', type: BlockType.AIMeetingNotesBlock },
  { key: 'transcript', type: BlockType.AIMeetingTranscriptionBlock },
];

const calculateAvailableTabs = (children: Array<Node & { type?: BlockType }>) => {
  return TAB_DEFS.filter((tab) => {
    const match = children.find((child) => child.type === tab.type);

    if (!match) return false;

    if (
      tab.type === BlockType.AIMeetingSummaryBlock ||
      tab.type === BlockType.AIMeetingTranscriptionBlock
    ) {
      return hasNodeContent(match);
    }

    return true;
  });
};

/**
 * Mock data factories
 */
const createTextNode = (text: string): Element => ({
  type: 'text' as unknown as BlockType,
  children: [{ text }],
} as unknown as Element);

const createParagraphNode = (text: string, blockId: string): Element =>
  ({
    type: BlockType.Paragraph,
    blockId,
    children: [createTextNode(text)],
  }) as unknown as Element;

const createSpeakerNode = (speakerId: string, timestamp: number, content: string): Element =>
  ({
    type: BlockType.AIMeetingSpeakerBlock,
    blockId: `speaker-${speakerId}`,
    data: { speaker_id: speakerId, timestamp },
    children: [createParagraphNode(content, `para-${speakerId}`)],
  }) as unknown as Element;

const createSectionNode = (type: BlockType, children: Element[]): Element =>
  ({
    type,
    blockId: `section-${type}`,
    children,
  }) as unknown as Element;

describe('AIMeetingBlock Logic', () => {
  describe('parseSpeakerInfoMap', () => {
    it('should return null for null/undefined input', () => {
      expect(parseSpeakerInfoMap(null)).toBeNull();
      expect(parseSpeakerInfoMap(undefined)).toBeNull();
    });

    it('should parse valid JSON string', () => {
      const jsonStr = JSON.stringify({
        speaker1: { name: 'Alice', email: 'alice@example.com' },
        speaker2: { name: 'Bob' },
      });

      const result = parseSpeakerInfoMap(jsonStr);

      expect(result).not.toBeNull();
      expect(result?.speaker1.name).toBe('Alice');
      expect(result?.speaker2.name).toBe('Bob');
    });

    it('should return object directly if already an object', () => {
      const obj = {
        speaker1: { name: 'Alice' },
      };

      const result = parseSpeakerInfoMap(obj);

      expect(result).toBe(obj);
    });

    it('should return null for invalid JSON string', () => {
      expect(parseSpeakerInfoMap('not valid json')).toBeNull();
      expect(parseSpeakerInfoMap('{invalid')).toBeNull();
    });

    it('should return null for non-object types', () => {
      expect(parseSpeakerInfoMap(123)).toBeNull();
      expect(parseSpeakerInfoMap(true)).toBeNull();
    });
  });

  describe('getBaseSpeakerId', () => {
    it('should extract base id before underscore', () => {
      expect(getBaseSpeakerId('speaker1_segment1')).toBe('speaker1');
      expect(getBaseSpeakerId('user_123_456')).toBe('user');
    });

    it('should return original id if no underscore', () => {
      expect(getBaseSpeakerId('speaker1')).toBe('speaker1');
      expect(getBaseSpeakerId('user')).toBe('user');
    });

    it('should handle empty string', () => {
      expect(getBaseSpeakerId('')).toBe('');
    });
  });

  describe('resolveSpeakerName', () => {
    const unknownLabel = 'Unknown speaker';
    const getFallbackLabel = (id: string) => `Speaker ${id}`;

    it('should return unknown label for undefined speaker id', () => {
      expect(resolveSpeakerName(undefined, null, unknownLabel, getFallbackLabel)).toBe(unknownLabel);
    });

    it('should return name from speaker info map', () => {
      const infoMap = {
        speaker1: { name: 'Alice' },
      };

      expect(resolveSpeakerName('speaker1', infoMap, unknownLabel, getFallbackLabel)).toBe('Alice');
    });

    it('should lookup using base id if direct match not found', () => {
      const infoMap = {
        speaker1: { name: 'Alice' },
      };

      expect(resolveSpeakerName('speaker1_segment2', infoMap, unknownLabel, getFallbackLabel)).toBe(
        'Alice'
      );
    });

    it('should return fallback label if no name found', () => {
      const infoMap = {
        speaker1: { email: 'alice@example.com' },
      };

      expect(resolveSpeakerName('speaker1', infoMap, unknownLabel, getFallbackLabel)).toBe(
        'Speaker speaker1'
      );
    });

    it('should trim whitespace from name', () => {
      const infoMap = {
        speaker1: { name: '  Alice  ' },
      };

      expect(resolveSpeakerName('speaker1', infoMap, unknownLabel, getFallbackLabel)).toBe('Alice');
    });

    it('should handle empty name as fallback', () => {
      const infoMap = {
        speaker1: { name: '   ' },
      };

      expect(resolveSpeakerName('speaker1', infoMap, unknownLabel, getFallbackLabel)).toBe(
        'Speaker speaker1'
      );
    });
  });

  describe('hasNodeContent', () => {
    it('should return false for undefined/null', () => {
      expect(hasNodeContent(undefined)).toBe(false);
    });

    it('should return false for empty text', () => {
      const node = createTextNode('');

      expect(hasNodeContent(node)).toBe(false);
    });

    it('should return false for whitespace only', () => {
      const node = createTextNode('   ');

      expect(hasNodeContent(node)).toBe(false);
    });

    it('should return true for non-empty text', () => {
      const node = createTextNode('Hello');

      expect(hasNodeContent(node)).toBe(true);
    });

    it('should check nested content', () => {
      const node = createParagraphNode('Nested content', 'block1');

      expect(hasNodeContent(node)).toBe(true);
    });
  });

  describe('calculateAvailableTabs', () => {
    it('should return notes tab even if empty', () => {
      const children = [createSectionNode(BlockType.AIMeetingNotesBlock, [])];

      const tabs = calculateAvailableTabs(children as Array<Node & { type?: BlockType }>);

      expect(tabs).toHaveLength(1);
      expect(tabs[0].key).toBe('notes');
    });

    it('should include summary tab only if it has content', () => {
      const emptyChildren = [
        createSectionNode(BlockType.AIMeetingSummaryBlock, []),
        createSectionNode(BlockType.AIMeetingNotesBlock, []),
      ];

      const tabsEmpty = calculateAvailableTabs(emptyChildren as Array<Node & { type?: BlockType }>);

      expect(tabsEmpty.find((t) => t.key === 'summary')).toBeUndefined();

      const withContent = [
        createSectionNode(BlockType.AIMeetingSummaryBlock, [
          createParagraphNode('Summary content', 'sum1'),
        ]),
        createSectionNode(BlockType.AIMeetingNotesBlock, []),
      ];

      const tabsWithContent = calculateAvailableTabs(
        withContent as Array<Node & { type?: BlockType }>
      );

      expect(tabsWithContent.find((t) => t.key === 'summary')).toBeDefined();
    });

    it('should include transcript tab only if it has content', () => {
      const emptyChildren = [
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, []),
        createSectionNode(BlockType.AIMeetingNotesBlock, []),
      ];

      const tabsEmpty = calculateAvailableTabs(emptyChildren as Array<Node & { type?: BlockType }>);

      expect(tabsEmpty.find((t) => t.key === 'transcript')).toBeUndefined();

      const withContent = [
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
          createSpeakerNode('s1', 0, 'Hello'),
        ]),
        createSectionNode(BlockType.AIMeetingNotesBlock, []),
      ];

      const tabsWithContent = calculateAvailableTabs(
        withContent as Array<Node & { type?: BlockType }>
      );

      expect(tabsWithContent.find((t) => t.key === 'transcript')).toBeDefined();
    });

    it('should return all tabs when all have content', () => {
      const children = [
        createSectionNode(BlockType.AIMeetingSummaryBlock, [
          createParagraphNode('Summary', 'sum1'),
        ]),
        createSectionNode(BlockType.AIMeetingNotesBlock, [createParagraphNode('Notes', 'note1')]),
        createSectionNode(BlockType.AIMeetingTranscriptionBlock, [
          createSpeakerNode('s1', 0, 'Transcript'),
        ]),
      ];

      const tabs = calculateAvailableTabs(children as Array<Node & { type?: BlockType }>);

      expect(tabs).toHaveLength(3);
      expect(tabs.map((t) => t.key)).toEqual(['summary', 'notes', 'transcript']);
    });
  });

  describe('insertSpeakerPrefix', () => {
    it('should insert speaker prefix before first text node', () => {
      const node = createParagraphNode('Hello world', 'block1');
      const result = insertSpeakerPrefix(node, 'Alice');

      expect(Element.isElement(result)).toBe(true);
      const textChildren = (result as Element).children[0] as Element;
      const texts = textChildren.children as Array<{ text: string; bold?: boolean }>;

      expect(texts[0].text).toBe('Alice: ');
      expect(texts[0].bold).toBe(true);
      expect(texts[1].text).toBe('Hello world');
    });

    it('should return non-element nodes unchanged', () => {
      const textNode = { text: 'plain text' } as unknown as Node;
      const result = insertSpeakerPrefix(textNode, 'Alice');

      expect(result).toEqual(textNode);
    });

    it('should not modify the original node', () => {
      const original = createParagraphNode('Original', 'block1');
      const originalJson = JSON.stringify(original);

      insertSpeakerPrefix(original, 'Alice');

      expect(JSON.stringify(original)).toBe(originalJson);
    });
  });

  describe('buildCopyText', () => {
    it('should return empty string for undefined/null', () => {
      expect(buildCopyText(undefined)).toBe('');
    });

    it('should return empty string for non-element nodes', () => {
      const textNode = { text: 'plain' } as unknown as Node;

      expect(buildCopyText(textNode)).toBe('');
    });

    it('should join child text content with newlines', () => {
      const node = {
        type: BlockType.AIMeetingSummaryBlock,
        children: [
          createParagraphNode('Line 1', 'p1'),
          createParagraphNode('Line 2', 'p2'),
          createParagraphNode('Line 3', 'p3'),
        ],
      } as unknown as Element;

      expect(buildCopyText(node)).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should filter out empty lines', () => {
      const node = {
        type: BlockType.AIMeetingSummaryBlock,
        children: [
          createParagraphNode('Line 1', 'p1'),
          createParagraphNode('', 'p2'),
          createParagraphNode('Line 3', 'p3'),
        ],
      } as unknown as Element;

      expect(buildCopyText(node)).toBe('Line 1\nLine 3');
    });

    it('should trim whitespace from lines', () => {
      const node = {
        type: BlockType.AIMeetingSummaryBlock,
        children: [createParagraphNode('  Line 1  ', 'p1'), createParagraphNode('  Line 2  ', 'p2')],
      } as unknown as Element;

      expect(buildCopyText(node)).toBe('Line 1\nLine 2');
    });
  });

  describe('cloneNode', () => {
    it('should create a deep copy', () => {
      const original = createParagraphNode('Test', 'block1');
      const cloned = cloneNode(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
    });

    it('should not share references with original', () => {
      const original = createParagraphNode('Test', 'block1');
      const cloned = cloneNode(original);

      (cloned.children[0] as Element).children[0] = { text: 'Modified' };

      const originalText = ((original.children[0] as Element).children[0] as { text: string }).text;

      expect(originalText).toBe('Test');
    });
  });
});

describe('Copy with Speaker Processing', () => {
  const speakerInfoMap = {
    s1: { name: 'Alice' },
    s2: { name: 'Bob' },
  };

  const processNodesForCopy = (
    nodes: Node[],
    infoMap: Record<string, Record<string, unknown>> | null
  ) => {
    const unknownLabel = 'Unknown speaker';
    const getFallbackLabel = (id: string) => `Speaker ${id}`;

    const processed: Node[] = [];

    nodes.forEach((node) => {
      if (Element.isElement(node) && node.type === BlockType.AIMeetingSpeakerBlock) {
        const speakerData = node.data as Record<string, unknown> | undefined;
        const speakerId = (speakerData?.speaker_id || speakerData?.speakerId) as string | undefined;
        const speakerName = resolveSpeakerName(speakerId, infoMap, unknownLabel, getFallbackLabel);
        const speakerChildren = node.children ?? [];

        speakerChildren.forEach((child, index) => {
          const clonedChild = cloneNode(child);

          if (index === 0) {
            processed.push(insertSpeakerPrefix(clonedChild, speakerName));
          } else {
            processed.push(clonedChild);
          }
        });
        return;
      }

      processed.push(cloneNode(node));
    });

    return processed;
  };

  it('should prepend speaker name to speaker block content', () => {
    const nodes = [createSpeakerNode('s1', 0, 'Hello everyone')];

    const processed = processNodesForCopy(nodes, speakerInfoMap);

    expect(processed.length).toBe(1);
    const textContent = ((processed[0] as Element).children[0] as Element)
      .children as Array<{ text: string; bold?: boolean }>;

    expect(textContent[0].text).toBe('Alice: ');
    expect(textContent[0].bold).toBe(true);
  });

  it('should use fallback label for unknown speakers', () => {
    const nodes = [createSpeakerNode('unknown', 0, 'Message')];

    const processed = processNodesForCopy(nodes, speakerInfoMap);
    const textContent = ((processed[0] as Element).children[0] as Element)
      .children as Array<{ text: string }>;

    expect(textContent[0].text).toBe('Speaker unknown: ');
  });

  it('should handle multiple speaker blocks', () => {
    const nodes = [
      createSpeakerNode('s1', 0, 'Hello'),
      createSpeakerNode('s2', 10, 'Hi there'),
      createSpeakerNode('s1', 20, 'How are you?'),
    ];

    const processed = processNodesForCopy(nodes, speakerInfoMap);

    expect(processed.length).toBe(3);

    const getText = (node: Node) => {
      return ((node as Element).children[0] as Element).children as Array<{ text: string }>;
    };

    expect(getText(processed[0])[0].text).toBe('Alice: ');
    expect(getText(processed[1])[0].text).toBe('Bob: ');
    expect(getText(processed[2])[0].text).toBe('Alice: ');
  });

  it('should pass through non-speaker nodes unchanged', () => {
    const nodes = [createParagraphNode('Regular paragraph', 'p1')];

    const processed = processNodesForCopy(nodes, speakerInfoMap);

    expect(processed.length).toBe(1);
    expect((processed[0] as Element).type).toBe(BlockType.Paragraph);
  });
});
