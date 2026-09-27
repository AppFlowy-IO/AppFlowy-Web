import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface ColumnResizeProps {
  fieldId: string;
  width: number;
  minWidth: number;
  onResize: (fieldId: string, width: number | null) => void;
  onCommit: (fieldId: string, width: number) => void;
}

/** Keeps pointer travel independent of the header moving underneath it. */
export function TimelineColumnResizeHandle({ fieldId, width, minWidth, onResize, onCommit }: ColumnResizeProps) {
  const drag = useRef<{
    fieldId: string;
    pointerId: number;
    startX: number;
    startWidth: number;
    width: number;
    element: HTMLDivElement;
  } | null>(null);
  const [active, setActive] = useState(false);
  const callbacks = useRef({ onResize, onCommit });

  useLayoutEffect(() => {
    callbacks.current = { onResize, onCommit };
  }, [onResize, onCommit]);

  const finish = useCallback((commit: boolean) => {
    const current = drag.current;

    if (!current) return;
    const { onResize, onCommit } = callbacks.current;

    drag.current = null;
    setActive(false);
    if (current.element.hasPointerCapture(current.pointerId)) {
      current.element.releasePointerCapture(current.pointerId);
    }

    try {
      if (commit && current.width !== current.startWidth) onCommit(current.fieldId, current.width);
    } finally {
      onResize(current.fieldId, null);
    }
  }, []);

  // A new field owns a new gesture. Callback identity changes from parent
  // renders must not act like unmounts and cancel the pointer in flight.
  useLayoutEffect(() => () => finish(false), [fieldId, finish]);

  useEffect(() => {
    if (!active) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    };

    const onBlur = () => finish(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [active, finish]);

  return (
    <div
      data-testid={`timeline-column-resize-${fieldId}`}
      className={cn(
        'absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none select-none border-r-2 border-transparent hover:border-fill-theme-thick',
        active && 'border-fill-theme-thick'
      )}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = {
          fieldId,
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: width,
          width,
          element: event.currentTarget,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setActive(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;

        if (!current || current.pointerId !== event.pointerId) return;
        const nextWidth = Math.max(minWidth, Math.round(current.startWidth + event.clientX - current.startX));

        if (nextWidth === current.width) return;
        current.width = nextWidth;
        callbacks.current.onResize(current.fieldId, nextWidth);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId === event.pointerId) finish(true);
      }}
      onPointerCancel={(event) => {
        if (drag.current?.pointerId === event.pointerId) finish(false);
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.pointerId === event.pointerId) finish(false);
      }}
      onClick={(event) => event.stopPropagation()}
    />
  );
}
