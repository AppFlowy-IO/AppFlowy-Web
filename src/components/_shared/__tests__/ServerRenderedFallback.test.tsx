import { act, lazy, type ReactNode, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  captureServerRenderedMarkup,
  releaseServerRenderedMarkup,
  ServerRenderedFallback,
} from '@/components/_shared/ServerRenderedFallback';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const SSR_PATH = '/docs/page';

/** A #root holding a server-rendered article, as deploy/html.ts emits it. */
const serverRenderedRoot = () => {
  document.body.innerHTML = '<div id="root"><article data-appflowy-ssr><h1>Server title</h1></article></div>';

  const root = document.getElementById('root') as HTMLElement;

  return { root, article: root.firstElementChild as HTMLElement };
};

/** A lazy component whose chunk "loads" when `load()` is called. */
const deferredLazy = (render: () => ReactNode) => {
  let load: () => void = () => undefined;
  const Component = lazy(
    () =>
      new Promise<{ default: () => JSX.Element }>((resolve) => {
        load = () => resolve({ default: () => <>{render()}</> });
      })
  );

  return { Component, load: () => load() };
};

const scrollTo = (element: HTMLElement, top: number) => {
  element.scrollTop = top;
  element.dispatchEvent(new Event('scroll'));
};

const spinner = () => document.querySelector('[role="status"]');

describe('ServerRenderedFallback', () => {
  let reactRoot: Root | undefined;

  const mount = (root: HTMLElement, element: ReactNode) => {
    reactRoot = createRoot(root);
    act(() => reactRoot?.render(element));
  };

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    releaseServerRenderedMarkup();
    window.history.pushState({}, '', SSR_PATH);
  });

  afterEach(() => {
    act(() => reactRoot?.unmount());
    reactRoot = undefined;
    document.body.innerHTML = '';
  });

  it('keeps the server-rendered article on screen while the first route chunk loads', async () => {
    const { root, article } = serverRenderedRoot();
    const page = deferredLazy(() => <main data-testid="app-page">App page</main>);

    captureServerRenderedMarkup(root);
    mount(
      root,
      <Suspense fallback={<ServerRenderedFallback label="Loading page" />}>
        <page.Component />
      </Suspense>
    );

    // React emptied #root on its first commit, yet the very same node is back
    // inside the fallback, and no spinner replaced it.
    expect(article.isConnected).toBe(true);
    expect(root.contains(article)).toBe(true);
    expect(article.parentElement).not.toBe(root);
    expect(article.parentElement?.getAttribute('aria-busy')).toBe('true');
    expect(spinner()).toBeNull();

    await act(async () => page.load());

    expect(root.querySelector('[data-testid="app-page"]')).not.toBeNull();
    expect(article.isConnected).toBe(false);
  });

  it('carries the article and its scroll position through consecutive route fallbacks', async () => {
    const { root, article } = serverRenderedRoot();
    const inner = deferredLazy(() => <main data-testid="app-page">App page</main>);
    const outer = deferredLazy(() => (
      <Suspense fallback={<ServerRenderedFallback label="Loading page" />}>
        <inner.Component />
      </Suspense>
    ));

    captureServerRenderedMarkup(root);
    // The reader scrolls the article before the app mounts.
    scrollTo(root, 300);

    mount(
      root,
      <Suspense fallback={<ServerRenderedFallback label="Loading page" />}>
        <outer.Component />
      </Suspense>
    );

    const firstContainer = article.parentElement as HTMLElement;

    expect(firstContainer.scrollTop).toBe(300);

    // Scrolling inside the fallback is remembered, and #root (which no longer
    // holds the article) cannot overwrite it.
    scrollTo(firstContainer, 500);
    scrollTo(root, 0);

    await act(async () => outer.load());

    const secondContainer = article.parentElement as HTMLElement;

    expect(article.isConnected).toBe(true);
    expect(secondContainer).not.toBe(firstContainer);
    expect(firstContainer.isConnected).toBe(false);
    expect(secondContainer.scrollTop).toBe(500);
    expect(spinner()).toBeNull();

    await act(async () => inner.load());

    expect(article.isConnected).toBe(false);
  });

  it('shows the spinner when there is no server-rendered article', () => {
    document.body.innerHTML = '<div id="root"></div>';

    const root = document.getElementById('root') as HTMLElement;
    const page = deferredLazy(() => null);

    captureServerRenderedMarkup(root);
    mount(
      root,
      <Suspense fallback={<ServerRenderedFallback label="Loading page" />}>
        <page.Component />
      </Suspense>
    );

    expect(spinner()?.getAttribute('aria-label')).toBe('Loading page');
  });

  it('ignores markup that is not a direct server-rendered child of #root', () => {
    document.body.innerHTML = '<div id="root"><div><article data-appflowy-ssr>Nested</article></div></div>';

    const root = document.getElementById('root') as HTMLElement;
    const page = deferredLazy(() => null);

    captureServerRenderedMarkup(root);
    mount(
      root,
      <Suspense fallback={<ServerRenderedFallback label="Loading page" />}>
        <page.Component />
      </Suspense>
    );

    expect(spinner()).not.toBeNull();
    expect(root.textContent).not.toContain('Nested');
  });

  it('shows the spinner on a different URL than the one the article belongs to', () => {
    const { root, article } = serverRenderedRoot();
    const page = deferredLazy(() => null);

    captureServerRenderedMarkup(root);
    window.history.pushState({}, '', '/docs/another-page');
    mount(
      root,
      <Suspense fallback={<ServerRenderedFallback label="Loading page" />}>
        <page.Component />
      </Suspense>
    );

    expect(spinner()).not.toBeNull();
    expect(article.isConnected).toBe(false);
  });

  it('shows the spinner once the markup is released', () => {
    const { root, article } = serverRenderedRoot();
    const page = deferredLazy(() => null);

    captureServerRenderedMarkup(root);
    releaseServerRenderedMarkup();
    mount(
      root,
      <Suspense fallback={<ServerRenderedFallback label="Loading page" />}>
        <page.Component />
      </Suspense>
    );

    expect(spinner()).not.toBeNull();
    expect(article.isConnected).toBe(false);
  });
});
