import { ReactNode } from 'react';
import { createPortal } from 'react-dom';

function DatabaseStickyTopOverlay ({
  children,
}: {
  children: ReactNode;
}) {
  const root = document.querySelector('.sticky-header-overlay');

  return root ? createPortal(
    children, root,
  ) : null;
}

export default DatabaseStickyTopOverlay;