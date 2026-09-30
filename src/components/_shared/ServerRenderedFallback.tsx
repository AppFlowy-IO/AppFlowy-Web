import { useLayoutEffect, useRef } from 'react';

import { FullScreenLoading } from '@/components/_shared/FullScreenLoading';

/**
 * Keeps a server-rendered published page on screen while the app loads.
 *
 * The client mounts with createRoot, which empties #root on its first commit,
 * and the first things it commits are route-chunk Suspense fallbacks. Without
 * this, a reader would see article → full-screen spinner → article. Instead,
 * the article's DOM node is captured before mounting and moved into each
 * fallback, so it stays in place (with its scroll position, and without
 * re-decoding images) until the published page itself commits.
 */

type CapturedMarkup = {
  node: Element;
  /** The article belongs to this URL only; other routes get the spinner. */
  pathname: string;
  scrollTop: number;
};

let captured: CapturedMarkup | null = null;
let stopTrackingRootScroll: (() => void) | undefined;

/**
 * Captures the server-rendered article in #root, if any. Call once, before
 * `createRoot(root).render(...)`.
 *
 * @returns Whether there was one, i.e. whether this is a server-rendered
 *   published page.
 */
export function captureServerRenderedMarkup(root: HTMLElement): boolean {
  const node = root.querySelector(':scope > [data-appflowy-ssr]');

  if (!node) return false;

  const markup: CapturedMarkup = { node, pathname: window.location.pathname, scrollTop: root.scrollTop };

  // Until React mounts, #root is the article's scroll container. Once React
  // moves the node out, #root no longer scrolls it, so later events are ignored.
  const onScroll = () => {
    if (node.parentElement === root) markup.scrollTop = root.scrollTop;
  };

  root.addEventListener('scroll', onScroll, { passive: true });
  stopTrackingRootScroll = () => root.removeEventListener('scroll', onScroll);
  captured = markup;
  return true;
}

/**
 * Forgets the captured article. Call once the published page has committed:
 * from then on, route fallbacks show the normal spinner.
 */
export function releaseServerRenderedMarkup() {
  stopTrackingRootScroll?.();
  stopTrackingRootScroll = undefined;
  captured = null;
}

function CapturedArticle({ markup }: { markup: CapturedMarkup }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Layout effect: the node must be in place before the browser paints the
  // commit in which React emptied #root, or the article would flash out.
  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    container.appendChild(markup.node);
    container.scrollTop = markup.scrollTop;

    const onScroll = () => {
      markup.scrollTop = container.scrollTop;
    };

    container.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', onScroll);
      if (markup.node.parentNode === container) container.removeChild(markup.node);
    };
  }, [markup]);

  // The article carries its own layout styles (deploy/html.ts SSR_STYLE); this
  // only takes over #root's role as its full-viewport scroll container. Not
  // aria-busy: the article is complete, readable content, and a busy region
  // may be held back from screen readers.
  return <div ref={containerRef} data-testid='server-rendered-fallback' className='fixed inset-0 overflow-y-auto' />;
}

/**
 * Suspense fallback for app-level route boundaries: the captured
 * server-rendered article when there is one for the current URL, otherwise
 * the usual full-screen spinner.
 */
export function ServerRenderedFallback({ label }: { label: string }) {
  const markup = captured && captured.pathname === window.location.pathname ? captured : null;

  return markup ? <CapturedArticle markup={markup} /> : <FullScreenLoading label={label} />;
}

export default ServerRenderedFallback;
