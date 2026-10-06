import { createEditor, Editor, Node } from 'slate';
import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: (_key: string, fallback: string) => fallback }));

import { YjsEditor } from '@/application/slate-yjs';
import { translateYEvents } from '@/application/slate-yjs/utils/applyToSlate';
import { yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { YDoc, YSharedRoot } from '@/application/types';

function fixture() {
  const doc = new Y.Doc() as YDoc;
  const root = doc.getMap('data');
  const document = new Y.Map();
  const blocks = new Y.Map<Y.Map<unknown>>();
  const children = new Y.Map<Y.Array<string>>();
  const text = new Y.Map<Y.Text>();
  const meta = new Y.Map();
  root.set('document', document);
  document.set('page_id', 'page');
  document.set('blocks', blocks);
  document.set('meta', meta);
  meta.set('children_map', children);
  meta.set('text_map', text);
  function block(id: string, parent = 'page') {
    blocks.set(
      id,
      new Y.Map<unknown>(
        Object.entries({
          id,
          ty: id === 'page' ? 'page' : 'paragraph',
          parent,
          children: id,
          data: '{}',
          external_id: id,
        })
      )
    );
    children.set(id, new Y.Array<string>());
    text.set(id, new Y.Text(id));
  }
  block('page', '');
  block('old');
  children.get('page')!.push(['old']);
  const editor = createEditor() as YjsEditor;
  editor.sharedRoot = root as YSharedRoot;
  editor.children = yDocToSlateContent(doc)!.children;
  root.observeDeep((events) => translateYEvents(editor, events));
  return { doc, editor, block, blocks, children };
}

describe('remote block transaction ordering', () => {
  it('inserts siblings in document order when map changes arrive in reverse order', () => {
    const { doc, editor, block, children } = fixture();
    expect(() =>
      doc.transact(() => {
        block('second');
        block('first');
        children.get('page')!.push(['first', 'second']);
      })
    ).not.toThrow();
    expect(editor.children.map(Node.string)).toEqual(['old', 'first', 'second']);
  });

  it('creates an ancestor before its nested children from one transaction', () => {
    const { doc, editor, block, children } = fixture();
    doc.transact(() => {
      block('child', 'parent');
      block('parent');
      children.get('parent')!.push(['child']);
      children.get('page')!.push(['parent']);
    });
    expect(editor.children).toEqual(yDocToSlateContent(doc)!.children);
    expect(Node.string(editor.children[1])).toBe('parentchild');
  });

  it('applies a replacement transaction before Slate normalizes its intermediate empty tree', () => {
    const { doc, editor, block, blocks, children } = fixture();
    doc.transact(() => {
      blocks.delete('old');
      children.get('page')!.delete(0, 1);
      block('second');
      block('first');
      children.get('page')!.push(['first', 'second']);
    });
    expect(editor.children).toEqual(yDocToSlateContent(doc)!.children);
    expect(Editor.isNormalizing(editor)).toBe(true);
  });
});
