import React, { ReactNode } from 'react';
import { createPortal } from 'react-dom';

function DatabaseStickyBottomOverlay ({
  scrollElement,
  children,
}: {
  scrollElement: Element | null;
  children: ReactNode;
}) {
  return scrollElement ? createPortal(
    <div
      className={'grid-sticky-overlay'}
      style={{
        width: '100%',
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
      }}
    >
      {children}
    </div>, scrollElement,
  ) : null;
}

export default DatabaseStickyBottomOverlay;