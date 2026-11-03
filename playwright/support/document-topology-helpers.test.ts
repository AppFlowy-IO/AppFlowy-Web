import { describe, expect, it } from '@jest/globals';
import * as Y from 'yjs';

import { readDocumentBodyText } from './document-topology-helpers';

function fixture() {
  const doc = new Y.Doc();
  const document = new Y.Map<unknown>();
  const blocks = new Y.Map<Y.Map<unknown>>();
  const meta = new Y.Map<unknown>();
  const children = new Y.Map<Y.Array<string>>();
  const texts = new Y.Map<Y.Text>();

  doc.getMap('data').set('document', document);
  document.set('page_id', 'root');
  document.set('blocks', blocks);
  document.set('meta', meta);
  meta.set('children_map', children);
  meta.set('text_map', texts);
  blocks.set('root', new Y.Map<unknown>([['children', 'root']]));
  const childIds = Y.Array.from(['paragraph']);

  children.set('root', childIds);
  blocks.set(
    'paragraph',
    new Y.Map<unknown>([
      ['parent', 'root'],
      ['children', 'nested'],
      ['external_type', 'text'],
      ['external_id', 'body'],
    ])
  );
  texts.set('body', new Y.Text(''));
  return { doc, blocks, children, texts, childIds };
}

describe('row document server topology assertions', () => {
  it('accepts one structural empty paragraph', () => {
    const { doc } = fixture();

    expect(readDocumentBodyText(doc)).toBe('');
    doc.destroy();
  });

  it('reads only reachable body text, excluding retained orphan text', () => {
    const { doc, texts } = fixture();

    texts.get('body')!.insert(0, 'Current body');
    texts.set('orphan', new Y.Text('Deleted body'));
    expect(readDocumentBodyText(doc)).toBe('Current body');
    doc.destroy();
  });

  it('rejects a duplicate empty paragraph that text-map checks would miss', () => {
    const { doc, childIds } = fixture();

    childIds.push(['paragraph']);
    expect(() => readDocumentBodyText(doc)).toThrow('repeated block (duplicate edge or cycle): paragraph');
    doc.destroy();
  });

  it('rejects a cycle without looping', () => {
    const { doc, children } = fixture();

    children.set('nested', Y.Array.from(['root']));
    expect(() => readDocumentBodyText(doc)).toThrow('repeated block (duplicate edge or cycle): root');
    doc.destroy();
  });

  it('rejects missing reachable blocks', () => {
    const { doc, blocks } = fixture();

    blocks.delete('paragraph');
    expect(() => readDocumentBodyText(doc)).toThrow('missing a reachable block: paragraph');
    doc.destroy();
  });

  it('rejects a mismatched child parent', () => {
    const { doc, blocks } = fixture();

    blocks.get('paragraph')!.set('parent', 'other');
    expect(() => readDocumentBodyText(doc)).toThrow('mismatched parent: paragraph');
    doc.destroy();
  });
});
