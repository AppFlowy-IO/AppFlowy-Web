import React, { forwardRef } from 'react';

const DatabaseStickyHorizontalScrollbar = forwardRef<HTMLDivElement, {
  visible: boolean,
  totalSize: number,
  onScrollLeft: (left: number) => void,
}>(({
  visible,
  totalSize,
  onScrollLeft,
}, ref) => {
  const [draggingBottomScrollbar, setDraggingBottomScrollbar] = React.useState(false);

  return <div
    ref={ref}
    style={{
      scrollBehavior: 'auto',
      visibility: visible ? 'visible' : 'hidden',
    }}
    onMouseDown={() => {
      setDraggingBottomScrollbar(true);
    }}
    onMouseUp={() => {
      setDraggingBottomScrollbar(false);
    }}
    onScroll={e => {
      if (!draggingBottomScrollbar) return;
      const scrollLeft = e.currentTarget.scrollLeft;

      onScrollLeft(scrollLeft);
    }}
    className={'h-3 w-full opacity-30 hover:opacity-60 overflow-y-hidden overflow-x-auto'}
  >
    <div
      style={{
        width: `${totalSize}px`,
      }}
    >
      &nbsp;
    </div>
  </div>;
});

export default DatabaseStickyHorizontalScrollbar;