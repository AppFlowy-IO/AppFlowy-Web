import { BlockType, CodeBlockData } from '@/application/types';
import { detectMarkdown, detectTSV } from '@/components/editor/utils/markdown-detector';

import { parseMarkdown } from './markdown-parser';
import { parseTSVTable } from './table-parser';
import { ParsedBlock } from './types';

type PasteChunk = {
  text: string;
};

type PasteFragmentMatch = {
  blocks: ParsedBlock[];
  consumedChunks: number;
};

type PasteFragmentDetector = {
  id: string;
  parse: (chunks: PasteChunk[], startIndex: number) => PasteFragmentMatch | null;
};

const MERMAID_LANGUAGE = 'mermaid';

const MERMAID_START_PATTERNS = [
  /^sequenceDiagram(?:-v2)?\b/i,
  /^flowchart\s+(?:TB|TD|BT|RL|LR)\b/i,
  /^graph\s+(?:TB|TD|BT|RL|LR)\b/i,
  /^classDiagram(?:-v2)?\b/i,
  /^stateDiagram(?:-v2)?\b/i,
  /^erDiagram\b/i,
  /^journey\b/i,
  /^gantt\b/i,
  /^pie\b/i,
  /^mindmap\b/i,
  /^timeline\b/i,
  /^gitGraph\b/i,
  /^quadrantChart\b/i,
  /^requirementDiagram\b/i,
  /^C4(?:Context|Container|Component|Dynamic|Deployment)\b/,
  /^(?:packet|block|architecture|xychart|sankey)-beta\b/i,
];

const fragmentDetectors: PasteFragmentDetector[] = [
  {
    id: MERMAID_LANGUAGE,
    parse: parseMermaidFragment,
  },
];

export function parsePlainTextFragments(text: string): ParsedBlock[] | null {
  const chunks = splitPasteChunks(text);

  if (!chunks.some((_, index) => parseFragmentChunk(chunks, index))) {
    return null;
  }

  const blocks: ParsedBlock[] = [];
  let detectedFragment = false;

  for (let index = 0; index < chunks.length;) {
    const parsedFragment = parseFragmentChunk(chunks, index);

    if (parsedFragment) {
      detectedFragment = true;
      blocks.push(...parsedFragment.blocks);
      index += parsedFragment.consumedChunks;
      continue;
    }

    const chunk = chunks[index];

    blocks.push(...parsePlainTextChunk(chunk.text));
    index += 1;
  }

  return detectedFragment && blocks.length > 0 ? blocks : null;
}

function parseFragmentChunk(chunks: PasteChunk[], startIndex: number): PasteFragmentMatch | null {
  for (const detector of fragmentDetectors) {
    const match = detector.parse(chunks, startIndex);

    if (match) return match;
  }

  return null;
}

function parseMermaidFragment(chunks: PasteChunk[], startIndex: number): PasteFragmentMatch | null {
  const firstChunk = chunks[startIndex];
  const firstDiagram = normalizeFragmentText(firstChunk.text);
  const firstLines = getNonEmptyLines(firstDiagram);

  if (firstLines.length === 0) return null;

  const firstDiagramLine = getFirstDiagramLine(firstLines);

  if (!firstDiagramLine || !isMermaidStartLine(firstDiagramLine)) return null;

  const diagramChunks = [firstChunk.text];
  let consumedChunks = 1;

  for (let index = startIndex + 1; index < chunks.length; index += 1) {
    const nextChunk = chunks[index];

    if (!isMermaidContinuationChunk(nextChunk.text)) break;

    diagramChunks.push(nextChunk.text);
    consumedChunks += 1;
  }

  const diagram = normalizeFragmentText(diagramChunks.join('\n\n'));
  const lines = getNonEmptyLines(diagram);

  if (lines.length === 0) return null;

  const isMultiLineDiagram = lines.length > 1;
  const isInlineDiagram = /;/.test(firstDiagramLine);

  if (!isMultiLineDiagram && !isInlineDiagram) return null;

  return {
    consumedChunks,
    blocks: [
      {
        type: BlockType.CodeBlock,
        data: { language: MERMAID_LANGUAGE } as CodeBlockData,
        text: diagram,
        formats: [],
        children: [],
      },
    ],
  };
}

function getFirstDiagramLine(lines: string[]): string | null {
  const first = lines.find((line) => !isMermaidPreambleLine(line.trim()))?.trim();

  return first ?? null;
}

function isMermaidStartLine(line: string): boolean {
  return MERMAID_START_PATTERNS.some((pattern) => pattern.test(line.trim()));
}

function isMermaidPreambleLine(line: string): boolean {
  return /^%%(?:\{[\s\S]*\}%%|.*)$/.test(line);
}

function isMermaidContinuationChunk(text: string): boolean {
  const lines = getNonEmptyLines(normalizeFragmentText(text));

  if (lines.length === 0) return false;

  return lines.every((line) => isMermaidContinuationLine(line.trim()));
}

function isMermaidContinuationLine(line: string): boolean {
  if (isMermaidPreambleLine(line)) return true;

  return [
    /^participant\s+\S+(?:\s+as\s+.+)?$/i,
    /^actor\s+\S+(?:\s+as\s+.+)?$/i,
    /^create\s+(?:participant|actor)\s+\S+(?:\s+as\s+.+)?$/i,
    /^destroy\s+\S+$/i,
    /^autonumber(?:\s+.*)?$/i,
    /^box(?:\s+.*)?$/i,
    /^end$/i,
    /^(?:activate|deactivate)\s+\S+$/i,
    /^(?:loop|alt|else|opt|par|and|critical|option|break|rect)(?:\s+.*)?$/i,
    /^Note\s+(?:left of|right of|over)\s+[^:]+:.+$/i,
    /^[\w.$()[\]{}<>"'\-/ ]+\s*(?:-+|=+|x-?|o-?)(?:>>|>|\))[\w.$()[\]{}<>"'\-/ ]*(?::.*)?$/i,
    /^(?:subgraph|direction|classDef|class|style|linkStyle|click|accTitle|accDescr)(?:\s+.*)?$/i,
    /^[\w.-]+(?:\[[^\]]+\]|\([^)]+\)|\{[^}]+\}|>[^]]+\])(?:\s*:::\w+)?$/i,
    /^[\w.$()[\]{}<>"'\-/ ]+\s*(?:-{2,}|={2,}|-\.|\.->|~~~|o--|x--).+$/i,
  ].some((pattern) => pattern.test(line));
}

function parsePlainTextChunk(text: string): ParsedBlock[] {
  const normalizedText = text.trim();

  if (!normalizedText) return [];

  if (detectMarkdown(normalizedText)) {
    const markdownBlocks = parseMarkdown(normalizedText);

    if (markdownBlocks.length > 0) return markdownBlocks;
  }

  if (detectTSV(normalizedText)) {
    const table = parseTSVTable(normalizedText);

    if (table) return [table];
  }

  return normalizedText
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      type: BlockType.Paragraph,
      data: {},
      text: line,
      formats: [],
      children: [],
    }));
}

function splitPasteChunks(text: string): PasteChunk[] {
  return normalizeLineEndings(text)
    .split(/\n[ \t]*\n+/)
    .map((chunk) => ({ text: chunk }))
    .filter((chunk) => chunk.text.trim().length > 0);
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function normalizeFragmentText(text: string): string {
  return dedent(trimOuterBlankLines(text));
}

function trimOuterBlankLines(text: string): string {
  return text
    .replace(/^(?:[ \t]*\r?\n)+/, '')
    .replace(/(?:\r?\n[ \t]*)+$/, '');
}

function dedent(text: string): string {
  const lines = text.split(/\r\n|\r|\n/);
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);

  if (indents.length === 0) return text;

  const minIndent = Math.min(...indents);

  if (minIndent === 0) return text;

  return lines.map((line) => line.slice(minIndent)).join('\n');
}

function getNonEmptyLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
}
