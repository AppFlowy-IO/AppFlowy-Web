import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { loadSidePeekWidth, saveSidePeekWidth } from './side-peek-width';

import type { CSSProperties, ReactNode } from 'react';

export const MIN_SIDE_PEEK_WIDTH = 560;
const MIN_PAGE_WIDTH = 320;

function subscribeToViewport(listener: () => void) {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

export function clampSidePeekWidth(width: number, available: number) {
  const maximum = Math.max(MIN_SIDE_PEEK_WIDTH, Math.min((available * 2) / 3, available - MIN_PAGE_WIDTH));

  return Math.min(maximum, Math.max(MIN_SIDE_PEEK_WIDTH, width));
}

type PeekOwner = {
  id: symbol;
  prepare: () => Promise<boolean>;
  close: () => void;
};

interface RowPeekLayoutState {
  container: HTMLDivElement | null;
  canShow: boolean;
  owner: symbol | null;
  claim: (owner: PeekOwner, isCurrent: () => boolean) => Promise<boolean>;
  release: (owner: symbol) => void;
  showSide: (owner: symbol, visible: boolean) => void;
}

const RowPeekLayoutContext = createContext<RowPeekLayoutState | null>(null);

export const useRowPeekLayout = () => useContext(RowPeekLayoutContext);

/** One page peek owner, independent of its side or center presentation. */
export function RowPeekLayout({
  children,
  leftOffset = 0,
  rightOffset = 0,
  disabled = false,
}: {
  children: ReactNode;
  leftOffset?: number;
  rightOffset?: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const viewport = useSyncExternalStore(
    subscribeToViewport,
    () => window.innerWidth,
    () => 0
  );
  const available = Math.max(0, viewport - leftOffset - rightOffset);
  const canShow = !disabled && viewport >= 1024 && available >= MIN_SIDE_PEEK_WIDTH + MIN_PAGE_WIDTH;
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [owner, setOwner] = useState<symbol | null>(null);
  const [sideOwner, setSideOwner] = useState<symbol | null>(null);
  const active = useRef<PeekOwner | null>(null);
  const claimRevision = useRef(0);
  const [preferredWidth, setPreferredWidth] = useState(MIN_SIDE_PEEK_WIDTH);
  const widthTouched = useRef(false);
  const width = clampSidePeekWidth(preferredWidth, available);
  const visible = owner !== null && sideOwner === owner && canShow;
  const drag = useRef<{ x: number; width: number; nextWidth?: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadSidePeekWidth().then((stored) => {
      // A slow read must not undo a resize already started in this session.
      if (!cancelled && !widthTouched.current && stored !== undefined) setPreferredWidth(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const claim = useCallback(async (next: PeekOwner, isCurrent: () => boolean) => {
    const revision = ++claimRevision.current;
    const previous = active.current;

    if (previous && previous.id !== next.id && !(await previous.prepare())) return false;
    if (!isCurrent() || revision !== claimRevision.current) return false;
    if (previous && previous.id !== next.id) previous.close();
    active.current = next;
    setOwner(next.id);
    return true;
  }, []);

  const release = useCallback((id: symbol) => {
    if (active.current?.id !== id) return;
    active.current = null;
    setOwner(null);
    setSideOwner(null);
  }, []);

  const showSide = useCallback((id: symbol, visible: boolean) => {
    if (active.current?.id !== id) return;
    setSideOwner(visible ? id : null);
  }, []);

  const value = useMemo(
    () => ({ container, canShow, owner, claim, release, showSide }),
    [container, canShow, owner, claim, release, showSide]
  );

  return (
    <RowPeekLayoutContext.Provider value={value}>
      <div
        className='h-screen w-screen'
        style={{ '--database-side-peek-width': `${visible ? width : 0}px` } as CSSProperties}
      >
        {children}
        <aside
          data-testid='database-side-peek'
          aria-label={t('grid.rowPage.sidePeek')}
          hidden={!visible}
          // Above the page, below every body-level overlay (MUI modals and Radix
          // menus are z-50), so editor panels and the peek's own menus stay on top.
          className='fixed bottom-0 top-12 z-40 bg-surface-primary'
          style={{ right: rightOffset, width }}
        >
          <div
            role='separator'
            tabIndex={0}
            aria-label={t('grid.rowPage.resizeSidePeek')}
            aria-orientation='vertical'
            aria-valuemin={MIN_SIDE_PEEK_WIDTH}
            aria-valuemax={Math.round(clampSidePeekWidth(Number.MAX_VALUE, available))}
            aria-valuenow={Math.round(width)}
            data-testid='row-peek-resizer'
            className='row-peek-resizer absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none focus-visible:outline-none'
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              widthTouched.current = true;
              drag.current = { x: event.clientX, width };
              event.currentTarget.setAttribute('data-dragging', 'true');
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!drag.current) return;
              const next = clampSidePeekWidth(drag.current.width + drag.current.x - event.clientX, available);

              drag.current.nextWidth = next;
              setPreferredWidth(next);
            }}
            onPointerUp={(event) => {
              const next = drag.current?.nextWidth;

              drag.current = null;
              event.currentTarget.removeAttribute('data-dragging');
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
              // Persist explicit resizes, not previews or automatic viewport clamping.
              if (next !== undefined) void saveSidePeekWidth(next);
            }}
            onLostPointerCapture={(event) => {
              drag.current = null;
              event.currentTarget.removeAttribute('data-dragging');
            }}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowLeft'
                  ? width + 32
                  : event.key === 'ArrowRight'
                  ? width - 32
                  : event.key === 'Home'
                  ? MIN_SIDE_PEEK_WIDTH
                  : event.key === 'End'
                  ? available
                  : undefined;

              if (next === undefined) return;
              event.preventDefault();
              widthTouched.current = true;
              const resized = clampSidePeekWidth(next, available);

              setPreferredWidth(resized);
              void saveSidePeekWidth(resized);
            }}
          />
          <div ref={setContainer} className='flex h-full min-h-0 flex-col' />
        </aside>
      </div>
    </RowPeekLayoutContext.Provider>
  );
}
