import { useCallback, useSyncExternalStore } from 'react';

import type { YjsEditor } from '@/application/slate-yjs';

type UploadError = { error: unknown };
type BlockState = {
  viewers: Set<symbol>;
  listeners: Set<() => void>;
  uploadError?: UploadError;
};

// Menus live outside the block's React subtree. Keep transient viewer state
// scoped to the editor, separate from the collaborative document.
const editors = new WeakMap<YjsEditor, Map<string, BlockState>>();

function getState(editor: YjsEditor, blockId: string) {
  let blocks = editors.get(editor);

  if (!blocks) editors.set(editor, (blocks = new Map()));
  let state = blocks.get(blockId);

  if (!state) blocks.set(blockId, (state = { viewers: new Set(), listeners: new Set() }));
  return state;
}

function releaseState(editor: YjsEditor, blockId: string, state: BlockState) {
  const blocks = editors.get(editor);

  if (blocks?.get(blockId) === state && !state.viewers.size && !state.listeners.size && !state.uploadError)
    blocks.delete(blockId);
}

function useSubscription(editor: YjsEditor, blockId: string) {
  return useCallback((listener: () => void) => {
    const state = getState(editor, blockId);

    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
      releaseState(editor, blockId, state);
    };
  }, [editor, blockId]);
}

export function usePDFReady(editor: YjsEditor, blockId: string) {
  const subscribe = useSubscription(editor, blockId);
  const snapshot = useCallback(() => Boolean(editors.get(editor)?.get(blockId)?.viewers.size), [editor, blockId]);

  return useSyncExternalStore(subscribe, snapshot, () => false);
}

export function registerPDFReady(editor: YjsEditor, blockId: string) {
  const state = getState(editor, blockId);
  const viewer = Symbol();

  state.viewers.add(viewer);
  state.listeners.forEach((listener) => listener());
  return () => {
    state.viewers.delete(viewer);
    state.listeners.forEach((listener) => listener());
    releaseState(editor, blockId, state);
  };
}

export function usePDFUploadError(editor: YjsEditor, blockId: string) {
  const subscribe = useSubscription(editor, blockId);
  const snapshot = useCallback(() => editors.get(editor)?.get(blockId)?.uploadError, [editor, blockId]);

  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}

export function reportPDFUploadError(editor: YjsEditor, blockId: string, error: unknown) {
  const state = getState(editor, blockId);

  state.uploadError = { error };
  state.listeners.forEach((listener) => listener());
}

export function clearPDFUploadError(editor: YjsEditor, blockId: string, error: UploadError) {
  const state = editors.get(editor)?.get(blockId);

  if (!state || state.uploadError !== error) return;
  state.uploadError = undefined;
  state.listeners.forEach((listener) => listener());
  releaseState(editor, blockId, state);
}
