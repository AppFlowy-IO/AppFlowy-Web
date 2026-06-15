import { ReactEditor } from 'slate-react';

// A DOMRect is "degenerate" when every value is 0. Chrome returns such a rect for a
// collapsed range positioned at an empty text node or directly next to a
// contentEditable=false element (e.g. a checklist/toggle start icon, or a block
// placeholder). Treating it as a valid position anchors popovers at the viewport's
// top-left corner instead of at the caret.
function isDegenerateRect (rect: DOMRect | undefined | null): boolean {
  return !rect || (rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0);
}

export function getRangeRect () {
  const domSelection = window.getSelection();
  const rangeCount = domSelection?.rangeCount;

  if (!rangeCount) return null;

  const domRange = rangeCount > 0 ? domSelection.getRangeAt(0) : undefined;

  if (!domRange) return null;

  const rect = domRange.getBoundingClientRect();

  if (!isDegenerateRect(rect)) return rect;

  // Fall back to the nearest ancestor element that has a real layout box so the caret
  // position can still be resolved (e.g. inside an empty checklist/to-do item).
  const startNode = domRange.startContainer;
  let el: Element | null = startNode.nodeType === Node.ELEMENT_NODE ? (startNode as Element) : startNode.parentElement;

  while (el) {
    const elRect = el.getBoundingClientRect();

    if (!isDegenerateRect(elRect)) return elRect;
    el = el.parentElement;
  }

  return rect;
}

export function getSelectionPosition (editor: ReactEditor) {

  const rect = getRangeRect();

  if (!rect) return null;
  let newRect;

  const domNode = ReactEditor.toDOMNode(editor, editor);
  const domNodeRect = domNode.getBoundingClientRect();

  // the default height of the toolbar is 30px
  const gap = 78;

  if (rect) {
    let relativeDomTop = rect.top - domNodeRect.top;
    const relativeDomLeft = rect.left - domNodeRect.left;

    // if the range is above the window, move the toolbar to the bottom of range
    if (rect.top < gap && rect.bottom > 48) {
      relativeDomTop = -domNodeRect.top + gap;
    }

    newRect = {
      top: relativeDomTop,
      left: relativeDomLeft,
      width: rect.width,
      height: rect.height,
    };
  }

  return newRect;
}

