import { createEditor, Editor, Element, Point, Range, Text } from 'slate';
import { withReact } from 'slate-react';
import * as Y from 'yjs';

import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { deltaInsertToSlateNode, slateNodeToDeltaInsert } from '@/application/slate-yjs/utils/convert';
import { CollabOrigin, BlockType } from '@/application/types';
import {
  insertBlock,
  withTestingYDoc,
} from '@/application/slate-yjs/__tests__/withTestingYjsEditor';

import {
  addInlineCommentAnchor,
  applyAuthorizedInlineCommentUpdate,
  collectInlineCommentAnchors,
  getInlineCommentIds,
  getInlineCommentSelection,
  removeInlineCommentAnchor,
} from '../anchors';

function createParagraphEditor(text = 'abcdefghij') {
  const editor = withReact(createEditor());

  editor.children = [
    {
      type: BlockType.Paragraph,
      blockId: 'block-1',
      children: [{ text }],
    },
  ];
  return editor;
}

function pointAtTextOffset(editor: Editor, targetOffset: number): Point {
  let traversed = 0;

  for (const [node, path] of Editor.nodes(editor, { at: [], match: Text.isText })) {
    if (!Text.isText(node)) continue;

    const end = traversed + node.text.length;

    if (targetOffset <= end) {
      return { path, offset: targetOffset - traversed };
    }

    traversed = end;
  }

  throw new Error(`Text offset ${targetOffset} is outside the editor`);
}

function rangeAtTextOffsets(editor: Editor, start: number, end: number): Range {
  return {
    anchor: pointAtTextOffset(editor, start),
    focus: pointAtTextOffset(editor, end),
  };
}

function textSegments(editor: Editor) {
  return Array.from(Editor.nodes(editor, { at: [], match: Text.isText })).map(([node]) => {
    if (!Text.isText(node)) throw new Error('Expected text');
    return { text: node.text, ids: getInlineCommentIds(node) };
  });
}

describe('desktop-compatible inline comment anchors', () => {
  it('preserves existing ids when comment selections overlap', () => {
    const editor = createParagraphEditor();
    const first = getInlineCommentSelection(editor, rangeAtTextOffsets(editor, 2, 8));

    expect(first).not.toBeNull();
    addInlineCommentAnchor(editor, first!, 'comment-1');

    const second = getInlineCommentSelection(editor, rangeAtTextOffsets(editor, 5, 10));

    expect(second).not.toBeNull();
    addInlineCommentAnchor(editor, second!, 'comment-2');

    expect(textSegments(editor)).toEqual([
      { text: 'ab', ids: [] },
      { text: 'cde', ids: ['comment-1'] },
      { text: 'fgh', ids: ['comment-1', 'comment-2'] },
      { text: 'ij', ids: ['comment-2'] },
    ]);

    const anchors = collectInlineCommentAnchors(editor);

    expect(anchors.get('comment-1')?.quotedText).toBe('cdefgh');
    expect(anchors.get('comment-2')?.quotedText).toBe('fghij');
    expect(anchors.get('comment-1')?.blockId).toBe('block-1');
  });

  it('removes only the requested id and keeps an overlapping comment', () => {
    const editor = createParagraphEditor();
    const first = getInlineCommentSelection(editor, rangeAtTextOffsets(editor, 2, 8));

    addInlineCommentAnchor(editor, first!, 'comment-1');
    const second = getInlineCommentSelection(editor, rangeAtTextOffsets(editor, 5, 10));

    addInlineCommentAnchor(editor, second!, 'comment-2');
    removeInlineCommentAnchor(editor, 'comment-1');

    expect(textSegments(editor)).toEqual([
      { text: 'abcde', ids: [] },
      { text: 'fghij', ids: ['comment-2'] },
    ]);
    expect(collectInlineCommentAnchors(editor).has('comment-1')).toBe(false);
    expect(collectInlineCommentAnchors(editor).get('comment-2')?.quotedText).toBe('fghij');
  });

  it('rejects collapsed, cross-block, and code-block selections', () => {
    const editor = createParagraphEditor('first');
    const collapsed = rangeAtTextOffsets(editor, 1, 1);

    expect(getInlineCommentSelection(editor, collapsed)).toBeNull();

    editor.children.push({
      type: BlockType.Paragraph,
      blockId: 'block-2',
      children: [{ text: 'second' }],
    });
    expect(
      getInlineCommentSelection(editor, {
        anchor: { path: [0, 0], offset: 1 },
        focus: { path: [1, 0], offset: 2 },
      })
    ).toBeNull();

    (editor.children[0] as Element).type = BlockType.CodeBlock;
    expect(
      getInlineCommentSelection(editor, { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 2 } })
    ).toBeNull();
  });

  it('round-trips comment-ids through the Slate/Yjs Delta conversion', () => {
    const delta = slateNodeToDeltaInsert({ text: 'selected', 'comment-ids': ['comment-1', 'comment-2'] });

    expect(delta).toEqual({
      insert: 'selected',
      attributes: { 'comment-ids': ['comment-1', 'comment-2'] },
    });
    expect(deltaInsertToSlateNode(delta)).toEqual({
      text: 'selected',
      'comment-ids': ['comment-1', 'comment-2'],
    });
  });

  it('reads the legacy scalar comment-id form emitted by older documents', () => {
    expect(getInlineCommentIds({ text: 'selected', 'comment-ids': 'legacy-comment' } as unknown as Text)).toEqual([
      'legacy-comment',
    ]);
  });

  it('keeps anchor add/remove transactions out of text undo history', () => {
    const doc = withTestingYDoc('page-1');
    const { applyDelta } = insertBlock({
      doc,
      blockObject: {
        id: 'block-1',
        ty: BlockType.Paragraph,
        relation_id: 'block-1',
        text_id: 'text-1',
        data: '{}',
      },
    });

    applyDelta([{ insert: 'abcdefghij' }]);

    const editor = withYHistory(
      withYjs(withReact(createEditor()), doc, {
        localOrigin: CollabOrigin.Local,
        readOnly: false,
      })
    );

    editor.connect();

    const selection = getInlineCommentSelection(editor, rangeAtTextOffsets(editor, 2, 8));

    addInlineCommentAnchor(editor, selection!, 'comment-1');
    expect(editor.undoManager.undoStack).toHaveLength(0);
    expect(collectInlineCommentAnchors(editor).has('comment-1')).toBe(true);

    removeInlineCommentAnchor(editor, 'comment-1');
    expect(editor.undoManager.undoStack).toHaveLength(0);
    expect(collectInlineCommentAnchors(editor).has('comment-1')).toBe(false);

    editor.disconnect();
  });

  it('does not consume live Yjs clocks until an authorized update is accepted', () => {
    const doc = withTestingYDoc('page-1');
    const { applyDelta } = insertBlock({
      doc,
      blockObject: {
        id: 'block-1',
        ty: BlockType.Paragraph,
        relation_id: 'block-1',
        text_id: 'text-1',
        data: '{}',
      },
    });

    applyDelta([{ insert: 'abcdefghij' }]);

    const editor = withYjs(withReact(createEditor()), doc, {
      localOrigin: CollabOrigin.Local,
      readOnly: true,
    });

    editor.connect();

    const beforeStateVector = Y.encodeStateVector(doc);
    const selection = getInlineCommentSelection(editor, rangeAtTextOffsets(editor, 2, 5));
    const rejectedUpdate = addInlineCommentAnchor(editor, selection!, 'comment-1', true);

    expect(rejectedUpdate).not.toBeNull();
    expect(Y.encodeStateVector(doc)).toEqual(beforeStateVector);
    expect(collectInlineCommentAnchors(editor).has('comment-1')).toBe(false);

    // Discarding a failed request leaves the live document untouched, so the
    // next independently generated update has no dependency on the failure.
    const acceptedUpdate = addInlineCommentAnchor(editor, selection!, 'comment-2', true);

    expect(acceptedUpdate).not.toBeNull();
    expect(applyAuthorizedInlineCommentUpdate(editor, acceptedUpdate!)).toBe(true);
    expect(collectInlineCommentAnchors(editor).get('comment-2')?.quotedText).toBe('cde');
    expect(collectInlineCommentAnchors(editor).has('comment-1')).toBe(false);

    editor.disconnect();
  });
});
