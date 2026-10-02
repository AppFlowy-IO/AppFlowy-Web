import { lazy, useEffect } from 'react';

// The rich text editor and display load on first use: most cells are plain
// text, and the editor brings the document's leaf renderers, mention panel
// and toolbar with it.
let editorModule: Promise<typeof import('./RichTextCellEditor')> | undefined;
let contentModule: Promise<typeof import('./RichTextCellContent')> | undefined;

function loadEditor() {
  editorModule ??= import('./RichTextCellEditor').catch((error: unknown) => {
    // A failed load (e.g. offline) is tried again on the next use.
    editorModule = undefined;
    throw error;
  });
  return editorModule;
}

function loadContent() {
  contentModule ??= import('./RichTextCellContent').catch((error: unknown) => {
    contentModule = undefined;
    throw error;
  });
  return contentModule;
}

export const RichTextCellEditor = lazy(loadEditor);
export const RichTextCellContent = lazy(loadContent);

/**
 * Starts loading the Text cell editor before it is needed. The first edit of
 * a session otherwise waits for it with no input in place, and keys typed
 * meanwhile (e.g. a new card's name, right after "New") are lost.
 */
export function preloadRichTextCellEditor() {
  void loadEditor().catch(() => undefined);
  void loadContent().catch(() => undefined);
}

/** Preloads the editor once a view or row page that can edit Text cells mounts. */
export function usePreloadRichTextCellEditor(enabled: boolean) {
  useEffect(() => {
    if (enabled) preloadRichTextCellEditor();
  }, [enabled]);
}
