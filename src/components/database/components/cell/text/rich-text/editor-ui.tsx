import { ComponentType, lazy, Suspense } from 'react';

import { Log } from '@/utils/log';

export const RICH_TEXT_CELL_OVERLAY_ATTR = 'data-rich-text-cell-overlay';

interface ControlsProps {
  onPersonPicked: (id: string, requireNotification: boolean) => void;
}

let controlsModule: Promise<{ RichTextCellEditorControls: ComponentType<ControlsProps> }> | undefined;

// Import failures leave the input usable, without its menus. A browser keeps
// a failed module fetch for the whole page, so the load is tried (and its
// failure logged) once. Rendering errors still reach the editor's boundary,
// which discards the unsafe draft instead of saving it.
function loadUI() {
  controlsModule ??= import('./RichTextCellEditorUI').catch((error: unknown) => {
    Log.warn('[RichTextCellEditor] menus could not be loaded; editing continues without them', error);
    return { RichTextCellEditorControls: () => null };
  });
  return controlsModule;
}

const Controls = lazy(() => loadUI().then((module) => ({ default: module.RichTextCellEditorControls })));

export function preloadRichTextCellUI() {
  void loadUI();
}

/** Menus load independently of the editable DOM, keeping the caret stable. */
export function RichTextCellEditorControls(props: ControlsProps) {
  return (
    <Suspense fallback={null}>
      <Controls {...props} />
    </Suspense>
  );
}
