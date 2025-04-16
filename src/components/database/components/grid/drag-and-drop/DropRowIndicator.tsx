import React from 'react';

interface DropIndicatorProps {
  edge: string | null;
  style?: React.CSSProperties;
  rowIndex: number;
}

export function DropRowIndicator ({ edge, style = {} }: DropIndicatorProps) {
  if (!edge) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        [edge === 'top' ? 'top' : 'bottom']: 0,
        top: edge === 'top' ? -2 : 'auto',
        zIndex: 1,
        ...style,
      }}
    >
      <div className={'absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-background-primary border-2 border-fill-theme-thick'} />
      <div
        style={{
          marginLeft: '4px',
          position: 'relative',
          width: '100%',
          backgroundColor: 'var(--fill-theme-thick)',
          height: '2px',
        }}
      />
    </div>
  );
}