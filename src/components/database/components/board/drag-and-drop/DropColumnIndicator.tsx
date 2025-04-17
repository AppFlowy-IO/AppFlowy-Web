import React from 'react';

interface DropIndicatorProps {
  edge: string | null;
  style?: React.CSSProperties;
}

export function DropColumnIndicator ({ edge, style = {} }: DropIndicatorProps) {
  if (!edge) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [edge === 'left' ? 'left' : 'right']: 0,
        left: edge === 'left' ? -5 : 'auto',
        right: edge === 'right' ? -5 : 'auto',
        zIndex: 1,
        ...style,
      }}
    >
      <div className={'absolute -top-1 -left-[3px] h-2 w-2 rounded-full bg-background-primary border-2 border-fill-theme-thick'} />
      <div
        style={{
          marginTop: '4px',
          position: 'relative',
          height: '100%',
          backgroundColor: 'var(--fill-theme-thick)',
          width: '2px',
        }}
      />
    </div>
  );
}