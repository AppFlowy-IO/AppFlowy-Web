import { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react';

import type { ReactNode, RefCallback } from 'react';

const BannerActionsContext = createContext<{
  slot: HTMLDivElement | null;
  headerRef: RefCallback<HTMLDivElement>;
  slotRef: RefCallback<HTMLDivElement>;
} | null>(null);

/** Let the existing banner own its controls while a roomy center header hosts them. */
export function RowPeekBannerActionsProvider({ side, children }: { side: boolean; children: ReactNode }) {
  const [header, setHeader] = useState<HTMLDivElement | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [fits, setFits] = useState(false);

  useLayoutEffect(() => {
    if (!header) return;
    // Match Desktop RowBanner's dialog-width threshold, independent of the
    // number of collaborators or the translated action labels beside it.
    const update = () => setFits(header.getBoundingClientRect().width >= 800);
    const observer = new ResizeObserver(update);

    update();
    observer.observe(header);
    return () => observer.disconnect();
  }, [header]);

  const value = useMemo(
    () => ({ slot: !side && fits ? slot : null, headerRef: setHeader, slotRef: setSlot }),
    [side, fits, slot]
  );

  return <BannerActionsContext.Provider value={value}>{children}</BannerActionsContext.Provider>;
}

export function useRowPeekBannerActions() {
  return useContext(BannerActionsContext);
}
