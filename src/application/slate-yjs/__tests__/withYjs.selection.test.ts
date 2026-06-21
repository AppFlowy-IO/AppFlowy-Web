/**
 * Regression tests for the "Cannot resolve a DOM point from Slate point" crash.
 *
 * Background
 * ----------
 * withYjs#applyRemoteEvents caches editor.selection BEFORE applying remote
 * events to editor.children, then restores it after the events are applied.
 * For transactions with `origin === null` (e.g. bare `Y.applyUpdate(doc, state)`
 * calls in row prefetch, version reset, version revert, etc.) this overwrite
 * is unconditional — the cached selection is written back without re-validating
 * its offsets against the new text-node lengths. When a remote update shortens
 * the text under the local cursor, the restored selection keeps a path that
 * still exists but an offset past the end of the new text. Slate-react's
 * render-time selection sync then calls ReactEditor.toDOMPoint, which finds
 * the DOM text shorter than the requested offset and throws.
 *
 * These tests assert the DESIRED post-fix behavior:
 *   • After a remote shrink, the selection is either cleared OR clamped so
 *     that `isValidSelection` returns true (offset within new text length).
 *   • A remote append leaves a valid selection unchanged.
 *
 * Until withYjs#applyRemoteEvents and #initializeDocumentContent are updated
 * to validate offsets (e.g. via `isValidSelection` + clamp/deselect), the two
 * shrink tests are expected to FAIL — that's how they protect against the
 * regression.
 */

import { expect } from '@jest/globals';
import { createEditor, Editor, Range, Transforms } from 'slate';
import * as Y from 'yjs';

import { yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { isValidSelection } from '@/application/slate-yjs/utils/transformSelection';
import { YjsEditorKey, YTextMap } from '@/application/types';

import {
  generateId,
  getTestingDocData,
  insertBlock,
  withTestingYDoc,
  withTestingYjsEditor,
} from './withTestingYjsEditor';

jest.mock('nanoid');
// __mocks__/lodash-es.ts and __mocks__/lodash-es/isEqual.ts are auto-applied
// for npm modules. They provide a partial surface that breaks translateYEvents
// here (auto-mocked `omit` is undefined; auto-mocked `isEqual` always returns
// true so text events get routed into the block-update branch). Use the real
// implementations so this test exercises the real applyRemoteEvents flow.
jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('lodash-es/isEqual', () => jest.requireActual('lodash/isEqual'));

/** Find the slate path of the first text leaf inside the first paragraph. */
function findFirstLeafPath(editor: Editor): number[] {
  for (const [node, path] of Editor.nodes(editor, { at: [], match: (n) => 'text' in n })) {
    if (typeof (node as { text: string }).text === 'string') {
      return path;
    }
  }

  throw new Error('No text leaf found in editor.children');
}

/**
 * Mutate `remoteDoc` (which mirrors `localDoc`) and ship the diff to
 * `localDoc` with origin=Remote, so withYjs treats it as a remote event.
 */
function shipRemoteUpdate(
  remoteDoc: Y.Doc,
  localDoc: Y.Doc,
  mutate: (textMap: YTextMap) => void
) {
  const before = Y.encodeStateVector(localDoc);
  const { meta } = getTestingDocData(remoteDoc);
  const textMap = meta.get(YjsEditorKey.text_map) as YTextMap;

  mutate(textMap);

  const diff = Y.encodeStateAsUpdateV2(remoteDoc, before);

  // Use origin=null to exercise withYjs#applyRemoteEvents's "restore cached
  // selection" branch (the buggy one). Other origins skip that branch and
  // rely on Slate's per-operation selection transforms, which clamp offsets
  // automatically and hide the bug.
  Y.applyUpdateV2(localDoc, diff);
}

function buildSyncedPair(blockId: string, initialText: string) {
  const pageId = generateId();
  const remoteDoc = withTestingYDoc(pageId);
  const remoteBlock = insertBlock({
    doc: remoteDoc,
    blockObject: {
      id: blockId,
      ty: 'paragraph',
      relation_id: blockId,
      text_id: blockId,
      data: '{}',
    },
  });

  remoteBlock.applyDelta([{ insert: initialText }]);

  const localDoc = new Y.Doc();

  Y.applyUpdateV2(localDoc, Y.encodeStateAsUpdateV2(remoteDoc));

  return { remoteDoc, localDoc };
}

describe('withYjs selection restoration after remote events', () => {
  it('keeps selection valid when remote shrink occurs under cursor', () => {
    const blockId = generateId();
    const { remoteDoc, localDoc } = buildSyncedPair(blockId, 'Hello World');

    const editor = withTestingYjsEditor(createEditor(), localDoc);

    editor.connect();

    // Sanity-check the slate tree mirrors the yjs tree.
    expect(editor.children).toEqual(yDocToSlateContent(localDoc)?.children ?? []);

    // Place the local "cursor" at the end of "Hello World" (offset 11).
    const leafPath = findFirstLeafPath(editor);

    expect(Editor.string(editor, leafPath)).toBe('Hello World');

    Transforms.select(editor, { path: leafPath, offset: 11 });

    expect(editor.selection).not.toBeNull();
    expect(Range.isCollapsed(editor.selection!)).toBe(true);
    expect(editor.selection!.anchor.offset).toBe(11);
    expect(isValidSelection(editor, editor.selection!)).toBe(true);

    // Collaborator shrinks the same text to "Hi".
    shipRemoteUpdate(remoteDoc, localDoc, (textMap) => {
      const text = textMap.get(blockId);

      expect(text).toBeDefined();
      expect(text!.toString()).toBe('Hello World');

      text!.delete(0, text!.length);
      text!.insert(0, 'Hi');
    });

    // Editor tree reflects "Hi" (length 2).
    expect(Editor.string(editor, leafPath)).toBe('Hi');

    // Post-fix expectation: the selection must NOT be left pointing past the
    // end of the new text. Either it is cleared, or its offset is clamped to
    // within the new text length. Anything else is the crash precondition
    // that fires "Cannot resolve a DOM point from Slate point" on next render.
    if (editor.selection !== null) {
      expect(isValidSelection(editor, editor.selection)).toBe(true);
      expect(editor.selection.anchor.offset).toBeLessThanOrEqual(2);
      expect(editor.selection.focus.offset).toBeLessThanOrEqual(2);
    }
  });

  it('keeps selection valid when remote trims to before the cursor offset', () => {
    const blockId = generateId();
    const { remoteDoc, localDoc } = buildSyncedPair(blockId, 'The quick brown fox');

    const editor = withTestingYjsEditor(createEditor(), localDoc);

    editor.connect();
    const leafPath = findFirstLeafPath(editor);

    // Cursor at offset 16 — the offending offset from the original error message.
    Transforms.select(editor, { path: leafPath, offset: 16 });
    expect(isValidSelection(editor, editor.selection!)).toBe(true);

    shipRemoteUpdate(remoteDoc, localDoc, (textMap) => {
      const text = textMap.get(blockId)!;

      // Trim to "The quick" (length 9), well under offset 16.
      text.delete(9, text.length - 9);
    });

    expect(Editor.string(editor, leafPath)).toBe('The quick');

    // Post-fix: offset 16 is past the new length 9, so the selection must
    // be cleared or clamped (offset <= 9) — never left at 16.
    if (editor.selection !== null) {
      expect(isValidSelection(editor, editor.selection)).toBe(true);
      expect(editor.selection.anchor.offset).toBeLessThanOrEqual(9);
      expect(editor.selection.focus.offset).toBeLessThanOrEqual(9);
    }
  });

  it('sanity: remote append leaves a valid selection unchanged', () => {
    // If a remote update only LENGTHENS text under the cursor, the cached
    // offset stays in-bounds and selection remains valid. This proves the bug
    // is specifically offset > new text length, not "any remote event
    // invalidates selection".
    const blockId = generateId();
    const { remoteDoc, localDoc } = buildSyncedPair(blockId, 'Hello');

    const editor = withTestingYjsEditor(createEditor(), localDoc);

    editor.connect();
    const leafPath = findFirstLeafPath(editor);

    Transforms.select(editor, { path: leafPath, offset: 5 });
    expect(isValidSelection(editor, editor.selection!)).toBe(true);

    shipRemoteUpdate(remoteDoc, localDoc, (textMap) => {
      const text = textMap.get(blockId)!;

      text.insert(text.length, ' World');
    });

    expect(Editor.string(editor, leafPath)).toBe('Hello World');
    expect(editor.selection!.anchor.offset).toBe(5);
    expect(isValidSelection(editor, editor.selection!)).toBe(true);
  });
});
