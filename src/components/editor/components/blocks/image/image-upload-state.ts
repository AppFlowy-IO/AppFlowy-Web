import { useCallback, useSyncExternalStore } from 'react';

import type { YjsEditor } from '@/application/slate-yjs';

type State = { active: Set<string>; errors: Map<string, { error: unknown }>; listeners: Set<() => void> };
const editors = new WeakMap<YjsEditor, State>();

function state(editor: YjsEditor) {
  let value = editors.get(editor);

  if (!value) editors.set(editor, (value = { active: new Set(), errors: new Map(), listeners: new Set() }));
  return value;
}

export function setImageUploading(editor: YjsEditor, id: string, active: boolean) {
  const value = state(editor);

  if (active) value.active.add(id);
  else value.active.delete(id);
  value.listeners.forEach((listener) => listener());
}

export function isImageUploading(editor: YjsEditor, id: string) {
  return !!editors.get(editor)?.active.has(id);
}

export function useImageUploading(editor: YjsEditor, id: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const value = state(editor);

      value.listeners.add(listener);
      return () => {
        value.listeners.delete(listener);
      };
    },
    [editor]
  );
  const snapshot = useCallback(() => isImageUploading(editor, id), [editor, id]);

  return useSyncExternalStore(subscribe, snapshot, () => false);
}

export function reportImageUploadError(editor: YjsEditor, id: string, error: unknown) {
  const value = state(editor);

  value.errors.set(id, { error });
  value.listeners.forEach((listener) => listener());
}

export function clearImageUploadError(editor: YjsEditor, id: string) {
  const value = state(editor);

  value.errors.delete(id);
  value.listeners.forEach((listener) => listener());
}

export function useImageUploadError(editor: YjsEditor, id: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const value = state(editor);

      value.listeners.add(listener);
      return () => {
        value.listeners.delete(listener);
      };
    },
    [editor]
  );
  const snapshot = useCallback(() => editors.get(editor)?.errors.get(id), [editor, id]);

  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}
