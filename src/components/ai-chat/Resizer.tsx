import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';

interface ResizerProps {
  drawerWidth: number;
  minWidth?: number;
  maxWidth?: number;
  onResize?: (width: number) => void;
}

const Resizer = ({
  minWidth: minWidthProp,
  maxWidth: maxWidthProp,
  onResize,
  drawerWidth,
}: ResizerProps) => {
  const [isResizing, setIsResizing] = useState(false);
  const onResizeRef = useRef(onResize);

  // Update ref when onResize changes
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  // Calculate bounds dynamically, with SSR-safe defaults
  const { minWidth, maxWidth } = useMemo(() => {
    if (typeof window === 'undefined') {
      return { minWidth: minWidthProp ?? 400, maxWidth: maxWidthProp ?? 800 };
    }

    return {
      minWidth: minWidthProp ?? Math.min(400, window.innerWidth / 4),
      maxWidth: maxWidthProp ?? Math.max(400, window.innerWidth / 2),
    };
  }, [minWidthProp, maxWidthProp]);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
  }, []);

  // Only add listeners when actively resizing
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const newWidth = window.innerWidth - e.clientX;

      if (newWidth >= minWidth && newWidth <= maxWidth) {
        onResizeRef.current?.(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, minWidth, maxWidth]);

  return (
    <div
      className="absolute top-0 h-full left-0 w-1 border-r-4 border-transparent hover:border-content-blue-300 cursor-col-resize"
      style={{ zIndex: 100, borderColor: isResizing ? 'var(--content-blue-300)' : undefined }}
      onMouseDown={drawerWidth > 0 ? startResizing : undefined}
    />
  );
};

export default React.memo(Resizer);