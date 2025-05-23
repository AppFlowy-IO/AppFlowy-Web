import React from 'react';

function DropColumnIndicator ({
  edge, style = {},
}: {
  edge: string | null;
  style?: React.CSSProperties;
}) {
  if (!edge) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [edge === 'left' ? 'left' : 'right']: 0,
        left: edge === 'left' ? -2 : 'auto',
        zIndex: 1,
        backgroundColor: 'var(--fill-theme-thick)',
        width: '2px',
        ...style,
      }}
    />
  );
}

export default DropColumnIndicator;