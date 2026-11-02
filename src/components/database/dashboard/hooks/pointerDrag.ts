import type { PointerEvent as ReactPointerEvent } from 'react';

export interface PointerDragCallbacks {
  cursor: 'col-resize' | 'row-resize';
  /** Pointer offset from the drag start, in CSS px. */
  onMove: (deltaX: number, deltaY: number) => void;
  /** `commit` is false when the drag was cancelled (Escape, pointercancel, blur). */
  onEnd: (commit: boolean) => void;
}

/**
 * Track a pointer drag on the document (so it keeps working when the pointer
 * leaves the handle), lock the cursor and text selection while it runs, and
 * return a cleanup that ends it without committing.
 */
export function startPointerDrag(event: ReactPointerEvent, { cursor, onMove, onEnd }: PointerDragCallbacks) {
  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;
  const body = document.body;
  const previousCursor = body.style.cursor;
  const previousUserSelect = body.style.userSelect;
  let finished = false;

  body.style.cursor = cursor;
  body.style.userSelect = 'none';

  const handleMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    moveEvent.preventDefault();
    onMove(moveEvent.clientX - startX, moveEvent.clientY - startY);
  };

  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    document.removeEventListener('pointermove', handleMove);
    document.removeEventListener('pointerup', handleUp);
    document.removeEventListener('pointercancel', handleCancel);
    document.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('blur', handleBlur);
    body.style.cursor = previousCursor;
    body.style.userSelect = previousUserSelect;
    onEnd(commit);
  };

  const handleUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerId) return;
    finish(true);
  };

  const handleCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId !== pointerId) return;
    finish(false);
  };

  const handleKeyDown = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key !== 'Escape') return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    finish(false);
  };

  const handleBlur = () => finish(false);

  document.addEventListener('pointermove', handleMove);
  document.addEventListener('pointerup', handleUp);
  document.addEventListener('pointercancel', handleCancel);
  document.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('blur', handleBlur);

  return () => finish(false);
}
