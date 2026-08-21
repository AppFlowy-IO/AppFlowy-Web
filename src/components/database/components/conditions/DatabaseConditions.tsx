import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDatabaseContext, useDatabaseView, useFiltersSelector, useSortsSelector } from '@/application/database-yjs';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
import { ReactComponent as ArrowLeftSvg } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as ArrowRightSvg } from '@/assets/icons/alt_arrow_right.svg';
import { AFScroller } from '@/components/_shared/scroller';
import { useConditionsContext } from '@/components/database/components/conditions/context';
import { Separator } from '@/components/ui/separator';

import Filters from 'src/components/database/components/filters/Filters';
import Sorts from 'src/components/database/components/sorts/Sorts';

const SCROLL_STEP = 200;

// Desktop parity: the filter/sort bar shows scroll arrow overlays with a fade
// gradient when its content overflows horizontally.
function useHorizontalScrollOverlay() {
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const observersRef = useRef<{ resize: ResizeObserver; mutation: MutationObserver } | null>(null);
  const rafRef = useRef<number | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Observer callbacks can fire on every text mutation in the bar (typing in
  // a filter input), and reading scrollWidth/clientWidth forces layout —
  // coalesce to one measurement per frame.
  const updateScrollState = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollElRef.current;

      if (!el) return;
      const maxScrollLeft = el.scrollWidth - el.clientWidth;

      setCanScrollLeft(el.scrollLeft > 1);
      setCanScrollRight(el.scrollLeft < maxScrollLeft - 1);
    });
  }, []);

  // Observers are attached in the ref callback (not a mount effect) so they
  // follow the element if the scroller ever recreates its scroll view.
  const setScrollEl = useCallback(
    (el: HTMLDivElement | null) => {
      if (el === scrollElRef.current) return;

      observersRef.current?.resize.disconnect();
      observersRef.current?.mutation.disconnect();
      observersRef.current = null;
      scrollElRef.current = el;

      if (!el) return;

      const resize = new ResizeObserver(updateScrollState);

      resize.observe(el);
      // Content changes (chips added/removed/relabeled) also affect scrollability.
      const mutation = new MutationObserver(updateScrollState);

      mutation.observe(el, { childList: true, subtree: true, characterData: true });
      observersRef.current = { resize, mutation };
      updateScrollState();
    },
    [updateScrollState]
  );

  useEffect(() => {
    return () => {
      observersRef.current?.resize.disconnect();
      observersRef.current?.mutation.disconnect();
      observersRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const scrollBy = useCallback((offset: number) => {
    scrollElRef.current?.scrollBy({ left: offset, behavior: 'smooth' });
  }, []);

  return { setScrollEl, canScrollLeft, canScrollRight, scrollBy, updateScrollState };
}

export function DatabaseConditions() {
  const conditionsContext = useConditionsContext();
  const expanded = conditionsContext?.expanded ?? false;
  const sorts = useSortsSelector();
  const filters = useFiltersSelector();
  const view = useDatabaseView();
  const { paddingStart, paddingEnd } = useDatabaseContext();
  const layout = Number(view?.get(YjsDatabaseKey.layout));
  const { setScrollEl, canScrollLeft, canScrollRight, scrollBy, updateScrollState } = useHorizontalScrollOverlay();
  const className = useMemo(() => {
    const classList = ['database-conditions min-w-0 max-w-full relative transform overflow-hidden transition-all'];

    if (layout === DatabaseViewLayout.Grid) {
      classList.push('max-sm:!pl-6');
      classList.push('pl-24');
    } else {
      classList.push('max-sm:!px-6');
      classList.push('px-24');
    }

    return classList.join(' ');
  }, [layout]);

  return (
    <div
      style={{
        // Collapse to 0 height when not expanded to avoid unnecessary space
        height: expanded ? '40px' : '0',
        visibility: expanded ? 'visible' : 'hidden',
        opacity: expanded ? 1 : 0,
        pointerEvents: expanded ? 'auto' : 'none',
        paddingLeft: paddingStart === undefined ? '96px' : paddingStart,
        paddingRight: paddingEnd === undefined ? '96px' : paddingEnd,
      }}
      className={className}
    >
      <AFScroller
        overflowYHidden
        hideScrollbars
        ref={setScrollEl}
        onScroll={updateScrollState}
        className={`flex items-center border-b border-border-primary`}
      >
        <Sorts />
        {sorts.length > 0 && filters.length > 0 && <Separator orientation={'vertical'} className={'!mx-2 !h-5'} />}
        <Filters />
      </AFScroller>
      {canScrollLeft && (
        <div
          className={'pointer-events-none absolute inset-y-0 z-10 flex items-center'}
          style={{ left: paddingStart === undefined ? '96px' : paddingStart }}
        >
          <button
            className={
              'pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md bg-background-primary text-icon-secondary hover:text-icon-primary'
            }
            data-testid={'conditions-scroll-left'}
            onClick={() => scrollBy(-SCROLL_STEP)}
          >
            <ArrowLeftSvg className={'h-5 w-5'} />
          </button>
          <div className={'h-full w-3 bg-gradient-to-r from-background-primary to-transparent'} />
        </div>
      )}
      {canScrollRight && (
        <div
          className={'pointer-events-none absolute inset-y-0 z-10 flex items-center'}
          style={{ right: paddingEnd === undefined ? '96px' : paddingEnd }}
        >
          <div className={'h-full w-3 bg-gradient-to-l from-background-primary to-transparent'} />
          <button
            className={
              'pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md bg-background-primary text-icon-secondary hover:text-icon-primary'
            }
            data-testid={'conditions-scroll-right'}
            onClick={() => scrollBy(SCROLL_STEP)}
          >
            <ArrowRightSvg className={'h-5 w-5'} />
          </button>
        </div>
      )}
    </div>
  );
}

export default DatabaseConditions;
