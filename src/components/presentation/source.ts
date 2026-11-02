import type { PageSnapshot, SourceBlock } from './types';

export function flattenBlocks(blocks: SourceBlock[]): SourceBlock[] {
  return blocks.flatMap((block) => [block, ...flattenBlocks(block.children)]);
}

export function sourceIds(snapshot: PageSnapshot): Set<string> {
  return new Set([
    snapshot.pageId,
    ...flattenBlocks(snapshot.blocks).map((b) => b.id),
    ...snapshot.properties.map((p) => p.id),
  ]);
}

// Local document-preview fingerprint only. AI operations use the server evidence revision.
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;

  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

export function parseMarkdown(text: string, title = 'Untitled presentation'): PageSnapshot {
  const blocks: SourceBlock[] = [];
  const stack: { indent: number; block: SourceBlock }[] = [];
  let code: SourceBlock | undefined;

  text.split('\n').forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      if (code) code = undefined;
      else {
        code = {
          id: `block-${index + 1}`,
          type: 'code',
          text: '',
          language: line.trim().slice(3).trim().split(/\s+/)[0] || undefined,
          children: [],
        };
        blocks.push(code);
      }

      return;
    }

    if (code) {
      code.text += `${line}\n`;
      return;
    }

    if (!line.trim()) return;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const item = /^(\s*)(?:[-*]|\d+\.)\s+(?:\[([ xX])\]\s+)?(.+)$/.exec(line);
    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim());
    const block: SourceBlock = {
      id: `block-${index + 1}`,
      type: heading
        ? 'heading'
        : /^\s*(---+|\*\*\*+)\s*$/.test(line)
        ? 'divider'
        : image
        ? 'image'
        : item
        ? item[2] !== undefined
          ? 'todo_list'
          : 'bulleted_list'
        : line.startsWith('> ')
        ? 'quote'
        : 'paragraph',
      text: heading ? heading[2] : image ? image[1] : item ? item[3] : line.replace(/^> /, ''),
      level: heading?.[1].length,
      checked: item ? item[2]?.toLowerCase() === 'x' : undefined,
      url: image?.[2],
      children: [],
    };
    const indent = item ? item[1].length : 0;

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (item && stack.length) stack[stack.length - 1].block.children.push(block);
    else blocks.push(block);
    if (item) stack.push({ indent, block });
    else stack.length = 0;
  });
  return {
    pageId: 'sample-page',
    title,
    kind: 'document',
    revision: fingerprint({ title, blocks }),
    blocks,
    properties: [],
    warnings: [],
  };
}

export interface DocumentSlide {
  title: string;
  blocks: SourceBlock[];
  titleSlide?: boolean;
  meeting?: SourceBlock;
}
export function splitDocument(snapshot: PageSnapshot): DocumentSlide[] {
  const result: DocumentSlide[] = [{ title: snapshot.title, blocks: [], titleSlide: true }];
  const hasDividers = snapshot.blocks.some((block) => block.type === 'divider');
  let current: SourceBlock[] = [];
  const flush = () => {
    if (current.length) {
      result.push({ title: '', blocks: current });
      current = [];
    }
  };

  for (const block of snapshot.blocks) {
    if (hasDividers && block.type === 'divider') {
      flush();
      continue;
    }

    if (!hasDividers && block.type === 'heading' && (block.level ?? 1) <= 2) flush();
    current.push(block);
  }

  flush();
  return result;
}
