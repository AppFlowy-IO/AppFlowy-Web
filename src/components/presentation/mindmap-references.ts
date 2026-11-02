import { flattenBlocks, sourceIds } from './source';

import type { MindMap, MindMapImport, PageSnapshot, SourceBlock } from './types';

/** Match rendered text across Markdown imports and rich-text formatting, not line positions. */
export function normalizeSourceQuote(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/!?\[([^\]]+)\]\([^\n]*?\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/^\s*(?:#{1,6}\s+|>\s*)/gm, '')
    .replace(/^\s*(?:[-+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function blockText(block: SourceBlock): string {
  return [block.text, ...block.children.map(blockText)].filter(Boolean).join(' ');
}

/** Never interpret L53 as the 53rd editor block: imports and edits change those positions. */
export function resolveMapReferences(map: MindMap, snapshot: PageSnapshot, imported?: MindMapImport) {
  // The complete server envelope can cite page roots, properties and media that
  // are not projected into visible text blocks. Never guess those references.
  if (snapshot.serverSource) {
    return new Map(
      map.nodes
        .flatMap((node) => node.sourceIds)
        .filter((id) => Object.prototype.hasOwnProperty.call(snapshot.serverSource!.references, id))
        .map((id) => [id, id])
    );
  }

  const available = sourceIds(snapshot);
  const passages = new Map<string, Set<string>>();
  const add = (text: string, id: string) => {
    const quote = normalizeSourceQuote(text);

    if (!quote) return;
    const matches = passages.get(quote) ?? new Set<string>();

    matches.add(id);
    passages.set(quote, matches);
  };

  for (const block of flattenBlocks(snapshot.blocks)) {
    // A table citation describes a record, not an arbitrary cell or the entire table.
    if (block.type === 'simple_table_row') add(blockText(block), block.id);
    else add(block.text, block.id);
  }

  // Prefer a document heading when the imported title also exists in the body.
  if (!passages.has(normalizeSourceQuote(snapshot.title))) add(snapshot.title, snapshot.pageId);
  snapshot.properties.forEach((property) => add(`${property.name}: ${property.value ?? ''}`, property.id));

  const resolved = new Map<string, string>();

  for (const ref of new Set(map.nodes.flatMap((node) => node.sourceIds))) {
    if (available.has(ref)) {
      resolved.set(ref, ref);
      continue;
    }

    const quote = imported?.sourceQuotes?.[ref];

    if (typeof quote !== 'string' || !quote) continue;
    const matches = passages.get(normalizeSourceQuote(quote));

    // A repeated passage needs an explicit block ID; guessing would cite the wrong location.
    if (matches?.size === 1) resolved.set(ref, [...matches][0]);
  }

  return resolved;
}
