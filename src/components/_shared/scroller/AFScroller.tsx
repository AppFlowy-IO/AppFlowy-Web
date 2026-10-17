import React from 'react';
import { Scrollbars } from 'react-custom-scrollbars-2';

import { cn } from '@/lib/utils';

export interface AFScrollerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  overflowXHidden?: boolean;
  overflowYHidden?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onScroll?: (e: React.UIEvent<unknown>) => void;
  setScrollableContainer?: (el: HTMLDivElement | null) => void;
  hideScrollbars?: boolean;
}

export const AFScroller = React.forwardRef(
  ({
    setScrollableContainer,
    onScroll,
    style,
    children,
    overflowXHidden,
    overflowYHidden,
    hideScrollbars,
    className,
  }: AFScrollerProps, ref) => {
    return (
      <Scrollbars
        onScroll={onScroll}
        autoHide
        hideTracksWhenNotNeeded
        ref={(el) => {
          if (!el) return;

          const scrollEl = el.container?.firstChild as HTMLElement;

          if (!scrollEl) return;
          setScrollableContainer?.(scrollEl as HTMLDivElement);

          if (typeof ref === 'function') {
            ref(scrollEl);
          } else if (ref) {
            ref.current = scrollEl;
          }
        }}
        renderThumbHorizontal={(props) =>
          <div {...props} style={{
            display: hideScrollbars ? 'none' : undefined,
          }}
               className={cn('appflowy-scrollbar-thumb-horizontal')}
          />}
        renderThumbVertical={(props) =>
          <div {...props} style={{
            display: hideScrollbars ? 'none' : undefined,
          }}
               className="appflowy-scrollbar-thumb-vertical"
          />}
        {...(overflowXHidden && {
          renderTrackHorizontal: (props) => (
            <div
              {...props}
              style={{
                display: 'none',
              }}
            />
          ),
        })}
        {...(overflowYHidden && {
          renderTrackVertical: (props) => (
            <div
              {...props}
              style={{
                display: 'none',
              }}
            />
          ),
        })}
        style={style}
        renderView={(props) => {
          // Scrollbars pushes a space-taking native scrollbar out of view with a negative
          // margin. That margin is reset to 0 below so the content keeps its exact width, so
          // hide the native bar with CSS instead whenever it would take space (classic
          // "always show" scrollbars on macOS/Linux, every Windows browser). Overlay
          // scrollbars measure 0 and stay native, as Scrollbars hides its own tracks for them.
          const nativeScrollbarTakesSpace = Number(props.style?.marginRight) < 0;

          return (
            <div
              {...props}
              style={{
                ...props.style,
                overflowX: overflowXHidden ? 'hidden' : 'auto',
                overflowY: overflowYHidden ? 'hidden' : 'auto',
                marginRight: 0,
                marginBottom: 0,
              }}
              className={cn(
                hideScrollbars ? 'appflowy-hidden-scroller' : 'appflowy-custom-scroller',
                nativeScrollbarTakesSpace && 'appflowy-hidden-scrollbar',
                className
              )}
            />
          );
        }}
      >
        {children}
      </Scrollbars>
    );
  },
);
