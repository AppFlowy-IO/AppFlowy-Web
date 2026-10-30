import * as Y from 'yjs';

/** Read reachable body text while rejecting structural corruption, including empty duplicate blocks. */
export function readDocumentBodyText(doc: Y.Doc): string {
  const document = doc.getMap('data').get('document') as Y.Map<unknown>;
  const rootId = document.get('page_id') as string;
  const blocks = document.get('blocks') as Y.Map<Y.Map<unknown>>;
  const meta = document.get('meta') as Y.Map<unknown>;
  const children = meta.get('children_map') as Y.Map<Y.Array<string>>;
  const texts = meta.get('text_map') as Y.Map<Y.Text>;
  const seen = new Set<string>();
  const pending = [{ id: rootId, parent: null as string | null }];
  const content: string[] = [];

  while (pending.length > 0) {
    const { id, parent } = pending.pop()!;

    if (seen.has(id)) throw new Error(`Document contains a repeated block (duplicate edge or cycle): ${id}`);
    seen.add(id);
    const block = blocks.get(id);

    if (!block) throw new Error(`Document is missing a reachable block: ${id}`);
    if (parent !== null && block.get('parent') !== parent) {
      throw new Error(`Document block has a mismatched parent: ${id}`);
    }

    if (parent !== null && block.get('external_type') === 'text') {
      const text = texts.get(block.get('external_id') as string);

      if (!text) throw new Error(`Document block is missing its text: ${id}`);
      content.push(text.toString());
    }

    const childIds = children.get(block.get('children') as string)?.toArray() ?? [];

    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      pending.push({ id: childIds[index], parent: id });
    }
  }

  return content.join('\n').trim();
}
