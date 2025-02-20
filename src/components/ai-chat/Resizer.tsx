import React, { useState, useCallback, useEffect } from 'react';

const Resizer = ({
  minWidth = Math.min(400, window.innerWidth / 4),
  maxWidth = Math.max(400, window.innerWidth / 2),
  onResize,
  drawerWidth,
}: {
  drawerWidth: number;
  minWidth?: number;
  maxWidth?: number;
  onResize?: (width: number) => void;
}) => {
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if(isResizing) {
        mouseMoveEvent.stopPropagation();
        mouseMoveEvent.preventDefault();
        const newWidth = window.innerWidth - mouseMoveEvent.clientX;

        if(newWidth >= minWidth && newWidth <= maxWidth) {
          onResize?.(newWidth);
        }
      }
    },
    [isResizing, minWidth, maxWidth, onResize],
  );

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  return (
    <div
      className="absolute top-0 h-full left-0 w-1 border-r-4 border-transparent hover:border-content-blue-300 cursor-col-resize"
      style={{ zIndex: 100, borderColor: isResizing ? 'var(--content-blue-300)' : undefined }}
      onMouseDown={drawerWidth > 0 ? startResizing : undefined}
    />
  );
};

export default Resizer;