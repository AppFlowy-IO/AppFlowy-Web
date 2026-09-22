import { lazy, Suspense } from 'react';

import type { GlobalFilterMenuProps } from './GlobalFilterMenu';

// The menu (with the editor and its value controls) only mounts inside an
// open popover, so its code loads on the first open instead of with every
// dashboard, including the ones viewers can only read.
const GlobalFilterMenu = lazy(() => import('./GlobalFilterMenu'));

/** Fetch the menu's code ahead of a click (a trigger's hover or focus). */
export function preloadGlobalFilterMenu() {
  void import('./GlobalFilterMenu');
}

export function LazyGlobalFilterMenu(props: GlobalFilterMenuProps) {
  return (
    <Suspense fallback={null}>
      <GlobalFilterMenu {...props} />
    </Suspense>
  );
}

export default LazyGlobalFilterMenu;
