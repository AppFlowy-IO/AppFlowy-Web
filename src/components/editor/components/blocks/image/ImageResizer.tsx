import React, { useCallback, useRef } from 'react';

function ImageResizer({
  minWidth,
  width,
  onWidthChange,
  isLeft,
  onDragStart,
  onDragEnd,
}: {
  isLeft?: boolean;
  minWidth: number;
  width: number;
  onWidthChange: (newWidth: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const originalWidth = useRef(width);
  const startX = useRef(0);

  const onResize = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      const diff = isLeft ? startX.current - e.clientX : e.clientX - startX.current;
      const newWidth = originalWidth.current + diff;

      if(newWidth < minWidth) {
        return;
      }

      onWidthChange(newWidth);
    },
    [isLeft, minWidth, onWidthChange],
  );

  const onResizeEnd = useCallback(() => {
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', onResizeEnd);
    onDragEnd?.();
  }, [onResize, onDragEnd]);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      startX.current = e.clientX;
      originalWidth.current = width;
      document.addEventListener('mousemove', onResize);
      document.addEventListener('mouseup', onResizeEnd);
      onDragStart?.();
    },
    [onResize, onResizeEnd, width, onDragStart],
  );

  return (
    <div
      onMouseDown={onResizeStart}
      style={{
        right: isLeft ? 'auto' : '2px',
        left: isLeft ? '-2px' : 'auto',
      }}
      className={'image-resizer'}
    >
      <div className={'resize-handle'} />
    </div>
  );
}

export default ImageResizer;
