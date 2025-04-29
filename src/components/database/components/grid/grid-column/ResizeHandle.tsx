import { cn } from '@/lib/utils';
import React, { useRef } from 'react';

interface ResizeHandleProps {
  fieldId: string;
  onResizeStart: (fieldId: string, element: HTMLElement) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function ResizeHandle ({
  fieldId,
  onResizeStart,
  className = '',
  style = {},
}: ResizeHandleProps) {
  const handleRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();

    if (handleRef.current) {
      onResizeStart(fieldId, handleRef.current);
    }
  };

  const [visible, setVisible] = React.useState(false);

  return (
    <div
      ref={handleRef}
      onMouseMove={() => {
        setVisible(true);
      }}
      onMouseLeave={() => setVisible(false)}
      className={cn(`column-resize-handle bg-fill-theme-thick`, className)}
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: '4px',
        cursor: 'col-resize',
        zIndex: 100,
        opacity: visible ? 1 : 0,
        ...style,
      }}
    />
  );
}