import { lazy, useEffect } from 'react';

// The rich text editor and the display of mentions and equations load on
// first use: most cells are plain text, and both bring the document's leaf
// renderers with them (the editor also the mention panel and the toolbar).
//
// A failed load (offline, or a chunk that a newer deploy replaced) stays
// failed until the page is reloaded: browsers keep a failed module fetch and
// do not request it again, and `React.lazy` keeps the error it got. So both
// are rendered inside an error boundary that falls back to plain text: a
// plain-text editor for the editor (TextCell, Title), the cell's text for the
// display (RichTextCellContent).
const loadEditor = () => import('./RichTextCellEditor');
const loadDocument = () => import('./RichTextCellDocument');

export const RichTextCellEditor = lazy(loadEditor);
export const RichTextCellDocument = lazy(loadDocument);

/**
 * Starts loading the Text cell editor before it is needed. The first edit of
 * a session otherwise waits for it with no input in place, and keys typed
 * meanwhile (e.g. a new card's name, right after "New") are lost.
 */
export function preloadRichTextCellEditor() {
  void loadEditor().catch(() => undefined);
  void loadDocument().catch(() => undefined);
}

/** Preloads the editor once a view or row page that can edit Text cells mounts. */
export function usePreloadRichTextCellEditor(enabled: boolean) {
  useEffect(() => {
    if (enabled) preloadRichTextCellEditor();
  }, [enabled]);
}
