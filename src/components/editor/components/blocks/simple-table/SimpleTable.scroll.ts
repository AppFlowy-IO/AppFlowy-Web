import type { WheelEvent } from 'react';

export function revealSimpleTableRow(row: HTMLElement) {
  const viewportBottom = window.visualViewport
    ? window.visualViewport.offsetTop + window.visualViewport.height
    : window.innerHeight;

  for (let ancestor = row.parentElement; ancestor; ancestor = ancestor?.parentElement ?? null) {
    if (ancestor === document.scrollingElement) break;
    if (!['auto', 'scroll', 'overlay'].includes(getComputedStyle(ancestor).overflowY) || ancestor.scrollHeight <= ancestor.clientHeight) continue;
    const bounds = ancestor.getBoundingClientRect();
    const bottom = Math.min(bounds.top + ancestor.clientTop + ancestor.clientHeight, viewportBottom);
    const overflow = row.getBoundingClientRect().bottom - bottom;

    // Change only the page's vertical position, preserving horizontal scrolling.
    if (overflow > 0) ancestor.scrollTop += overflow;
    return;
  }

  const overflow = row.getBoundingClientRect().bottom - viewportBottom;

  if (overflow > 0) window.scrollBy({ top: overflow });
}

// An open MUI menu's backdrop intercepts wheel events above the table.
// Forward horizontal gestures over its viewport to the native scroller.
export function scrollSimpleTableFromMenu(event: WheelEvent, tableElement: Element | null) {
  const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);

  if (!delta || !tableElement) return;
  if (event.target instanceof Element && event.target.closest('.MuiPopover-paper')) return;
  const scroller = tableElement.querySelector<HTMLElement>('.simple-table-scroll-container');

  if (!scroller) return;
  const bounds = scroller.getBoundingClientRect();

  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientWidth : 1;

  scroller.scrollLeft += delta * unit;
}
