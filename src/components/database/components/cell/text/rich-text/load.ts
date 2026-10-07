import { useEffect } from 'react';

import { preloadRichTextCellUI } from './editor-ui';

// Input, selection and draft ownership are available as soon as a cell can
// enter edit mode, and so are the leaf renderers: loading them later could
// replace text DOM under an active browser selection. Read-only chips
// (RichTextCellDocument) use those same renderers, so they are part of this
// eager code as well. Only the editor's optional menus load afterward.
export { default as RichTextCellEditor } from './RichTextCellEditor';

/** Warms the editor's optional menus; input readiness never depends on this. */
export function preloadRichTextCellEditor() {
  preloadRichTextCellUI();
}

/** Preloads the editor's menus once a view or row page that can edit Text cells mounts. */
export function usePreloadRichTextCellEditor(enabled: boolean) {
  useEffect(() => {
    if (enabled) preloadRichTextCellEditor();
  }, [enabled]);
}
