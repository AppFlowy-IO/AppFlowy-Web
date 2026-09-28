import { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useDatabaseContextOptional } from '@/application/database-yjs/context';

function DatabaseStickyTopOverlay({ children }: { children: ReactNode }) {
  const context = useDatabaseContextOptional();
  const history = context?.dataSource;
  const root = history
    ? document.getElementById(history.id)?.querySelector('[data-history-sticky-overlay]')
    : document.querySelector('.sticky-header-overlay');

  return root ? createPortal(children, root) : null;
}

export default DatabaseStickyTopOverlay;
