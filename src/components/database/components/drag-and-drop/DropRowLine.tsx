import React from 'react';

interface DropIndicatorProps {
  edge: string | null;
  style?: React.CSSProperties;
}

/**
 * Plain horizontal drop line (no knob, no rounding) for vertical lists such as
 * the sidebar. The knobbed {@link DropRowIndicator} is kept for the grid/
 * property reordering where that affordance is wanted.
 */
function DropRowLine({ edge, style = {} }: DropIndicatorProps) {
  if (!edge) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        [edge === 'top' ? 'top' : 'bottom']: 0,
        zIndex: 1,
        height: '2px',
        backgroundColor: 'var(--fill-theme-thick)',
        ...style,
      }}
    />
  );
}

export default DropRowLine;
