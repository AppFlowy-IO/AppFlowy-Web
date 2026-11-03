import { isEqual } from 'lodash-es';

import { YDoc, YjsEditorKey } from '@/application/types';

import type { Transaction } from 'yjs';


/** An opaque value revision. It must never retain a document or its row data. */
export type RowDocRevision = { parent?: RowDocRevision };

const revisions = new WeakMap<YDoc, { current: RowDocRevision; destroyed: boolean }>();

function rootOf(revision: RowDocRevision): RowDocRevision {
  let root = revision;

  while (root.parent) root = root.parent;
  let current = revision;

  while (current.parent && current.parent !== root) {
    const next = current.parent;

    current.parent = root;
    current = next;
  }

  return root;
}

export function captureRowDocRevision(doc: YDoc): RowDocRevision {
  const existing = revisions.get(doc);

  if (existing) return existing.current;
  const state = { current: {} as RowDocRevision, destroyed: false };
  // Callbacks capture only this small state, never the document. An edit
  // starts a new generation for this doc without changing an equal sibling.
  const bump = () => { state.current = {}; };

  revisions.set(doc, state);
  doc.on('afterTransaction', (transaction: Transaction) => {
    if (transaction.changed.size > 0 || transaction.deleteSet.clients.size > 0) bump();
  });
  doc.on('destroy', () => {
    state.destroyed = true;
    bump();
  });
  return state.current;
}

export function hasRowDocRevision(doc: YDoc, revision: RowDocRevision): boolean {
  const state = revisions.get(doc);

  return Boolean(state && !state.destroyed && rootOf(state.current) === rootOf(revision));
}

/**
 * A fenced seed-to-canonical adoption can keep a derived result when the
 * complete input data is equal. Compare once per pair of value revisions;
 * later consumers reuse the token, without keeping a serialized row copy.
 */
export function shareEquivalentRowDocRevision(previous: YDoc, canonical: YDoc) {
  const previousState = revisions.get(previous);

  if (!previousState || previousState.destroyed || revisions.get(canonical)?.destroyed) return;
  const previousRoot = rootOf(previousState.current);
  const canonicalRoot = rootOf(captureRowDocRevision(canonical));

  if (previousRoot === canonicalRoot) return;
  if (!isEqual(
    previous.getMap(YjsEditorKey.data_section).toJSON(),
    canonical.getMap(YjsEditorKey.data_section).toJSON()
  )) return;

  previousRoot.parent = canonicalRoot;
}
