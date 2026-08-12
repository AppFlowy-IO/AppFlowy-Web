import type { ResolvedMessageSource } from './message-sources';

const MARKDOWN_CONTROL_CHARACTERS: Record<string, string> = {
  '\\': '＼',
  '`': 'ˋ',
  '*': '∗',
  _: '＿',
  '[': '［',
  ']': '］',
  '(': '（',
  ')': '）',
  '{': '｛',
  '}': '｝',
  '|': '｜',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatCitationLabel(label: string): string {
  const normalized = label
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\\`*_(){}|[\]]/g, (character) => MARKDOWN_CONTROL_CHARACTERS[character] || character);

  return `【${normalized}】`;
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
}

function replaceOutsideInlineCode(value: string, replaceText: (text: string) => string): string {
  let output = '';
  let segmentStart = 0;
  let delimiterLength = 0;
  let cursor = 0;

  while (cursor < value.length) {
    if (value[cursor] !== '`' || isEscaped(value, cursor)) {
      cursor += 1;
      continue;
    }

    let runEnd = cursor + 1;

    while (runEnd < value.length && value[runEnd] === '`') {
      runEnd += 1;
    }

    const runLength = runEnd - cursor;

    if (delimiterLength === 0) {
      output += replaceText(value.slice(segmentStart, cursor));
      output += value.slice(cursor, runEnd);
      delimiterLength = runLength;
      segmentStart = runEnd;
    } else if (runLength === delimiterLength) {
      output += value.slice(segmentStart, runEnd);
      delimiterLength = 0;
      segmentStart = runEnd;
    }

    cursor = runEnd;
  }

  output += delimiterLength === 0 ? replaceText(value.slice(segmentStart)) : value.slice(segmentStart);

  return output;
}

function replaceOutsideCodeBlocks(markdown: string, replaceText: (text: string) => string): string {
  const lines = markdown.match(/[^\n]*(?:\n|$)/g) || [];
  let fenceCharacter = '';
  let fenceLength = 0;

  return lines
    .filter((line, index) => line.length > 0 || index < lines.length - 1)
    .map((lineWithEnding) => {
      const hasLineEnding = lineWithEnding.endsWith('\n');
      const line = hasLineEnding ? lineWithEnding.slice(0, -1) : lineWithEnding;
      const fenceMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);

      if (fenceCharacter) {
        const closingFence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);

        if (closingFence && closingFence[1][0] === fenceCharacter && closingFence[1].length >= fenceLength) {
          fenceCharacter = '';
          fenceLength = 0;
        }

        return lineWithEnding;
      }

      if (fenceMatch) {
        fenceCharacter = fenceMatch[1][0];
        fenceLength = fenceMatch[1].length;
        return lineWithEnding;
      }

      if (/^(?: {4}|\t)/.test(line)) {
        return lineWithEnding;
      }

      const replacedLine = replaceOutsideInlineCode(line, replaceText);

      return hasLineEnding ? `${replacedLine}\n` : replacedLine;
    })
    .join('');
}

export function resolveCitationMarkdown(markdown: string, sources: ResolvedMessageSource[]): string {
  if (!markdown || sources.length === 0) return markdown;

  const labelByCitationId = new Map<string, string>();

  sources.forEach(({ metadata, label }) => {
    const citationId = metadata.citation_id?.trim();

    if (citationId && !labelByCitationId.has(citationId)) {
      labelByCitationId.set(citationId, formatCitationLabel(label || citationId));
    }
  });

  if (labelByCitationId.size === 0) return markdown;

  const citationIds = Array.from(labelByCitationId.keys()).sort((left, right) => right.length - left.length);
  const citationPattern = new RegExp(`\\[\\[?(${citationIds.map(escapeRegExp).join('|')})\\]\\]?`, 'g');

  return replaceOutsideCodeBlocks(markdown, (text) =>
    text.replace(citationPattern, (marker, citationId: string) => labelByCitationId.get(citationId) || marker)
  );
}
