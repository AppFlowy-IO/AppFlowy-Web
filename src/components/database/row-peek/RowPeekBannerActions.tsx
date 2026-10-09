import { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react';

import type { ReactNode, RefCallback } from 'react';

const BannerActionsContext = createContext<{
  slot: HTMLDivElement | null;
  headerRef: RefCallback<HTMLDivElement>;
} | null>(null);

/** Let the existing banner own its controls while a roomy center header hosts them. */
export function RowPeekBannerActionsProvider({ side, children }: { side: boolean; children: ReactNode }) {
  const [header, setHeader] = useState<HTMLDivElement | null>(null);
  const [fits, setFits] = useState(false);

  useLayoutEffect(() => {
    if (!header) return;
    const update = () => setFits(header.clientWidth >= 220);
    const observer = new ResizeObserver(update);

    update();
    observer.observe(header);
    return () => observer.disconnect();
  }, [header]);

  const value = useMemo(() => ({ slot: !side && fits ? header : null, headerRef: setHeader }), [side, fits, header]);

  return <BannerActionsContext.Provider value={value}>{children}</BannerActionsContext.Provider>;
}

export function useRowPeekBannerActions() {
  return useContext(BannerActionsContext);
}
