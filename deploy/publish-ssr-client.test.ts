/**
 * Contract test between the server's SSR output and the client code that
 * consumes it, run on the real HTML the server renders: the client must find
 * the inlined snapshot and the server-rendered article exactly where
 * deploy/html.ts puts them. Each side is unit-tested on its own; this catches
 * the two drifting apart (a renamed id, a moved element, a changed escape).
 */

import { jest } from '@jest/globals';
import { act, createElement, lazy, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import path from 'path';

import { publishedRichDocumentPayload } from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';
import {
  peekInlinedPublishSnapshot,
  releaseInlinedPublishSnapshot,
} from '@/application/publish-snapshot/inlined';
import {
  captureServerRenderedMarkup,
  releaseServerRenderedMarkup,
  ServerRenderedFallback,
} from '@/components/_shared/ServerRenderedFallback';

import { renderPublishPage } from './html';
import { serializePublishedPage } from './publish-serializer';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const actualFs = jest.requireActual<typeof import('fs')>('fs');
// The same frozen Vite entry HTML the golden test uses.
const indexTemplate = actualFs.readFileSync(path.join(__dirname, '__golden__', 'template.html'), 'utf8');

jest.mock('pino', () => () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: () => indexTemplate,
}));

const { namespace, publishName } = publishedRichDocumentPayload;
const PATHNAME = `/${namespace}/${publishName}`;

// Text that would break out of an inline script if the server escaped it
// wrongly. The separators are built from code points so this source never
// holds the raw characters.
const HOSTILE_NAME = `</script><script>alert(1)</script><!-- & ${String.fromCharCode(0x2028, 0x2029)}`;
const payload = {
  ...publishedRichDocumentPayload,
  view: { ...publishedRichDocumentPayload.view, name: HOSTILE_NAME },
};

/** Serves the page the way routes.ts does, then loads it as the browser would. */
const loadServerRenderedPage = () => {
  const serialized = serializePublishedPage(payload);

  if (!serialized.ok) throw new Error(`serializer declined: ${serialized.reason}`);

  const html = renderPublishPage({
    hostname: 'appflowy.test',
    pathname: PATHNAME,
    ssr: { bodyHtml: serialized.html, snapshotJson: JSON.stringify(payload) },
  });
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  document.replaceChild(document.adoptNode(parsed.documentElement), document.documentElement);
  window.history.pushState({}, '', PATHNAME);

  return document.getElementById('root') as HTMLElement;
};

describe('server-rendered published page, as read by the client', () => {
  let reactRoot: Root | undefined;

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    releaseInlinedPublishSnapshot();
    releaseServerRenderedMarkup();
  });

  afterEach(() => {
    act(() => reactRoot?.unmount());
    reactRoot = undefined;
  });

  it('places the snapshot where the app entry script will find it', () => {
    loadServerRenderedPage();

    const block = document.getElementById('appflowy-publish-snapshot');
    const entryScript = document.querySelector('script[type="module"]');

    expect(block?.getAttribute('type')).toBe('application/json');
    expect(block?.previousElementSibling?.id).toBe('root');
    // Parsed before the app's entry module runs.
    expect(block && entryScript && block.compareDocumentPosition(entryScript)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    // Only the data block and the template's own scripts: nothing injected.
    expect(document.querySelectorAll('script')).toHaveLength(3);
  });

  it('lets the client reuse the inlined snapshot, hostile text intact', () => {
    loadServerRenderedPage();

    const snapshot = peekInlinedPublishSnapshot(namespace, publishName);

    expect(snapshot?.kind).toBe('document');
    expect(snapshot?.view.name).toBe(HOSTILE_NAME);
    expect(snapshot?.namespace).toBe(namespace);
  });

  it('keeps the server-rendered article on screen when the app mounts', async () => {
    const root = loadServerRenderedPage();
    const article = root.querySelector(':scope > [data-appflowy-ssr]');

    expect(article?.textContent).toContain(HOSTILE_NAME);

    let load: () => void = () => undefined;
    const Page = lazy(
      () =>
        new Promise<{ default: () => ReturnType<typeof createElement> }>((resolve) => {
          load = () => resolve({ default: () => createElement('main', { 'data-testid': 'app-page' }) });
        })
    );

    // What src/main.tsx does.
    captureServerRenderedMarkup(root);
    reactRoot = createRoot(root);
    act(() =>
      reactRoot?.render(
        createElement(
          Suspense,
          { fallback: createElement(ServerRenderedFallback, { label: 'Loading page' }) },
          createElement(Page)
        )
      )
    );

    expect(article?.isConnected).toBe(true);
    expect(document.querySelector('[role="status"]')).toBeNull();

    await act(async () => load());

    expect(root.querySelector('[data-testid="app-page"]')).not.toBeNull();
    expect(article?.isConnected).toBe(false);
  });
});
