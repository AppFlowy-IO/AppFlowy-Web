import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, Suspense } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { publishedDocumentPayload } from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';
import { INLINED_PUBLISH_SNAPSHOT_ID, releaseInlinedPublishSnapshot } from '@/application/publish-snapshot/inlined';
import type { PublishedPageSnapshot } from '@/application/publish-snapshot/types';
import * as serverRenderedFallback from '@/components/_shared/ServerRenderedFallback';

import PublishView from '../PublishView';

let mockIsMobile = false;

const mockGetPage = jest.fn<Promise<PublishedPageSnapshot>, [string, string]>();

jest.mock('@/application/publish-snapshot/data-source', () => ({
  createPublishSnapshotDataSource: () => ({ getPage: (...args: [string, string]) => mockGetPage(...args) }),
}));

jest.mock('@/application/publish', () => ({
  PublishProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Keep the real layouts and AFScroller so these tests cover the final scroll handoff.
jest.mock('@/components/publish/PublishMain', () => ({
  __esModule: true,
  default: ({ snapshot }: { snapshot?: PublishedPageSnapshot }) => (
    <div data-testid="layout">{snapshot ? `${snapshot.publishName}:${snapshot.view.name}` : 'loading'}</div>
  ),
}));

jest.mock('@/components/publish/header', () => ({ PublishViewHeader: () => null }));
jest.mock('@/components/publish/SideBar', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/_shared/mobile-topbar/MobileTopBar', () => ({ __esModule: true, default: () => null }));

jest.mock('@/components/error/NotFound', () => ({
  __esModule: true,
  default: () => <div data-testid="not-found" />,
}));

jest.mock('@/utils/platform', () => ({
  getPlatform: () => ({ isMobile: mockIsMobile }),
}));

/** Emits the block the way deploy/html.ts does: a JSON data script after #root. */
const inline = (value: unknown) => {
  const script = document.createElement('script');

  script.type = 'application/json';
  script.id = INLINED_PUBLISH_SNAPSHOT_ID;
  script.textContent = JSON.stringify(value);
  document.body.appendChild(script);
};

const inlinedBlock = () => document.getElementById(INLINED_PUBLISH_SNAPSHOT_ID);

const NAMESPACE = publishedDocumentPayload.namespace;
const PUBLISH_NAME = publishedDocumentPayload.publishName;

const fetchedSnapshot = {
  ...publishedDocumentPayload,
  view: { ...publishedDocumentPayload.view, name: 'Fetched' },
} as unknown as PublishedPageSnapshot;

const renderView = (publishName = PUBLISH_NAME, container?: HTMLElement) =>
  render(
    <MemoryRouter>
      <PublishView namespace={NAMESPACE} publishName={publishName} />
    </MemoryRouter>,
    { container }
  );

const captureArticle = () => {
  const root = document.createElement('div');

  root.innerHTML = '<article data-appflowy-ssr><h1>Server title</h1><p>Already readable</p></article>';
  document.body.appendChild(root);
  serverRenderedFallback.captureServerRenderedMarkup(root);

  return { root, article: root.firstElementChild as HTMLElement };
};

describe('PublishView snapshot handoff', () => {
  beforeEach(() => {
    mockIsMobile = false;
    jest.restoreAllMocks();
    mockGetPage.mockReset();
    mockGetPage.mockResolvedValue(fetchedSnapshot);
    releaseInlinedPublishSnapshot();
    serverRenderedFallback.releaseServerRenderedMarkup();
    jest.spyOn(serverRenderedFallback, 'releaseServerRenderedMarkup');
    window.history.replaceState({}, '', `/${NAMESPACE}/${PUBLISH_NAME}`);
  });

  it('renders the inlined snapshot immediately and does not fetch', async () => {
    inline(publishedDocumentPayload);

    renderView();

    expect(screen.getByTestId('layout').textContent).toBe(`${PUBLISH_NAME}:Published document`);
    // Give any stray effect a chance to run before asserting it did not fetch.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockGetPage).not.toHaveBeenCalled();
  });

  it('releases the inlined snapshot and the server-rendered markup once mounted', () => {
    inline(publishedDocumentPayload);

    renderView();

    expect(inlinedBlock()).toBeNull();
    expect(serverRenderedFallback.releaseServerRenderedMarkup).toHaveBeenCalled();
  });

  it('releases the server-rendered markup on a normal (non-SSR) load too', () => {
    renderView();

    expect(serverRenderedFallback.releaseServerRenderedMarkup).toHaveBeenCalled();
  });

  it.each([false, true])('transfers the reading position to the client scroller under StrictMode (mobile: %s)', async (isMobile) => {
    mockIsMobile = isMobile;
    let resolveSnapshot!: (snapshot: PublishedPageSnapshot) => void;

    mockGetPage.mockReturnValue(new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));

    const { root, article } = captureArticle();

    root.scrollTop = 300;
    root.dispatchEvent(new Event('scroll'));
    render(
      <StrictMode>
        <MemoryRouter>
          <PublishView namespace={NAMESPACE} publishName={PUBLISH_NAME} />
        </MemoryRouter>
      </StrictMode>,
      { container: root }
    );

    expect(article.isConnected).toBe(true);
    expect(article.parentElement?.scrollTop).toBe(300);
    expect(screen.queryByTestId('layout')).toBeNull();
    expect(serverRenderedFallback.releaseServerRenderedMarkup).not.toHaveBeenCalled();

    // Include a final scroll whose event has not fired before the handoff.
    article.parentElement!.scrollTop = 620;

    await act(async () => resolveSnapshot(fetchedSnapshot));

    const scroller = root.querySelector('.appflowy-scroll-container') as HTMLElement;

    expect(scroller.scrollTop).toBe(620);
    expect(serverRenderedFallback.hasServerRenderedMarkup()).toBe(false);
    // A subsequent ref attachment must not reset the reader's new position.
    scroller.scrollTop = 800;
    await act(async () => { window.dispatchEvent(new Event('resize')); });
    expect(scroller.scrollTop).toBe(800);

    expect(screen.getByTestId('layout').textContent).toBe(`${PUBLISH_NAME}:Fetched`);
    expect(article.isConnected).toBe(false);
    expect(serverRenderedFallback.releaseServerRenderedMarkup).toHaveBeenCalled();
  });

  it.each([false, true])('restores an inlined page directly from the SSR root (mobile: %s)', async (isMobile) => {
    mockIsMobile = isMobile;
    inline(publishedDocumentPayload);

    const { root } = captureArticle();

    root.scrollTop = 300;
    root.dispatchEvent(new Event('scroll'));
    await act(async () => { renderView(PUBLISH_NAME, root); });

    expect(root.querySelector('.appflowy-scroll-container')?.scrollTop).toBe(300);
    expect(serverRenderedFallback.hasServerRenderedMarkup()).toBe(false);
  });

  it('keeps the article readable if the non-inlined snapshot fetch fails', async () => {
    mockGetPage.mockRejectedValue(new Error('Network unavailable'));

    const { root, article } = captureArticle();

    await act(async () => {
      renderView(PUBLISH_NAME, root);
    });

    expect(article.isConnected).toBe(true);
    expect(screen.getByText('Already readable')).toBeTruthy();
    expect(screen.queryByTestId('not-found')).toBeNull();
    expect(screen.queryByTestId('layout')).toBeNull();
    expect(serverRenderedFallback.releaseServerRenderedMarkup).not.toHaveBeenCalled();
  });

  it('releases the pending article when navigating to another page', async () => {
    let resolveSnapshot!: (snapshot: PublishedPageSnapshot) => void;

    mockGetPage.mockReturnValue(new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));

    const { root, article } = captureArticle();
    const { rerender } = renderView(PUBLISH_NAME, root);

    expect(article.isConnected).toBe(true);
    article.parentElement!.scrollTop = 450;
    article.parentElement!.dispatchEvent(new Event('scroll'));
    window.history.pushState({}, '', `/${NAMESPACE}/next-page`);
    mockGetPage.mockRejectedValue(new Error('404'));

    rerender(
      <MemoryRouter>
        <PublishView namespace={NAMESPACE} publishName="next-page" />
      </MemoryRouter>
    );

    expect(article.isConnected).toBe(false);
    expect(root.querySelector('.appflowy-scroll-container')?.scrollTop).toBe(0);
    expect(serverRenderedFallback.releaseServerRenderedMarkup).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('not-found')).toBeTruthy());
    await act(async () => resolveSnapshot(fetchedSnapshot));
    expect(screen.queryByTestId('layout')).toBeNull();
  });

  it('still uses the inlined snapshot when the first render is discarded', async () => {
    // A sibling that suspends on the first mount makes React throw away the
    // whole uncommitted tree, including PublishView's state; the remount must
    // find the snapshot again rather than fall back to fetching.
    inline(publishedDocumentPayload);

    let resume: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let suspended = false;

    function SuspendOnce() {
      if (!suspended) {
        suspended = true;
        throw gate;
      }

      return null;
    }

    render(
      <MemoryRouter>
        <Suspense fallback={<div data-testid="suspended" />}>
          <PublishView namespace={NAMESPACE} publishName={PUBLISH_NAME} />
          <SuspendOnce />
        </Suspense>
      </MemoryRouter>
    );

    expect(screen.getByTestId('suspended')).toBeTruthy();
    // Nothing committed yet, so nothing may have been released.
    expect(inlinedBlock()).not.toBeNull();

    await act(async () => {
      resume();
      await gate;
    });

    expect(screen.getByTestId('layout').textContent).toBe(`${PUBLISH_NAME}:Published document`);
    expect(mockGetPage).not.toHaveBeenCalled();
    expect(inlinedBlock()).toBeNull();
  });

  it('does not refetch under StrictMode', async () => {
    // StrictMode mounts, unmounts and remounts effects; the repeated effect
    // must not treat the inlined page as a navigation.
    inline(publishedDocumentPayload);

    render(
      <StrictMode>
        <MemoryRouter>
          <PublishView namespace={NAMESPACE} publishName={PUBLISH_NAME} />
        </MemoryRouter>
      </StrictMode>
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('layout').textContent).toBe(`${PUBLISH_NAME}:Published document`);
    expect(mockGetPage).not.toHaveBeenCalled();
  });

  it('fetches when no snapshot is inlined', async () => {
    renderView();

    expect(screen.getByTestId('layout').textContent).toBe('loading');
    await waitFor(() => expect(screen.getByTestId('layout').textContent).toBe(`${PUBLISH_NAME}:Fetched`));
    expect(mockGetPage).toHaveBeenCalledWith(NAMESPACE, PUBLISH_NAME);
  });

  it('shows NotFound when there is no inlined snapshot and the fetch fails', async () => {
    mockGetPage.mockRejectedValue(new Error('404'));

    renderView();

    await waitFor(() => expect(screen.getByTestId('not-found')).toBeTruthy());
  });

  it('fetches when the inlined snapshot belongs to another page', async () => {
    inline({ ...publishedDocumentPayload, publishName: 'other-page' });

    renderView();

    await waitFor(() => expect(mockGetPage).toHaveBeenCalledWith(NAMESPACE, PUBLISH_NAME));
  });

  it.each([
    ['a string', 'not a snapshot'],
    ['null', null],
    ['an empty object', {}],
    ['a wrong schema version', { ...publishedDocumentPayload, schemaVersion: 2 }],
    ['an unknown kind', { ...publishedDocumentPayload, kind: 'whiteboard' }],
    ['a missing view', { ...publishedDocumentPayload, view: undefined }],
    ['a database snapshot without database data', { ...publishedDocumentPayload, kind: 'database' }],
  ])('falls back to fetching when the inlined block is %s', async (_label, value) => {
    inline(value);

    renderView();

    await waitFor(() => expect(screen.getByTestId('layout').textContent).toBe(`${PUBLISH_NAME}:Fetched`));
    expect(mockGetPage).toHaveBeenCalledTimes(1);
  });

  it('fetches normally after navigating to another page', async () => {
    inline(publishedDocumentPayload);

    const { rerender } = renderView();

    expect(mockGetPage).not.toHaveBeenCalled();

    rerender(
      <MemoryRouter>
        <PublishView namespace={NAMESPACE} publishName="next-page" />
      </MemoryRouter>
    );

    await waitFor(() => expect(mockGetPage).toHaveBeenCalledWith(NAMESPACE, 'next-page'));
  });

  it('fetches the inlined page again after navigating away and back', async () => {
    inline(publishedDocumentPayload);

    const { rerender } = renderView();
    const show = (publishName: string) =>
      rerender(
        <MemoryRouter>
          <PublishView namespace={NAMESPACE} publishName={publishName} />
        </MemoryRouter>
      );

    show('next-page');
    await waitFor(() => expect(mockGetPage).toHaveBeenCalledWith(NAMESPACE, 'next-page'));

    show(PUBLISH_NAME);
    await waitFor(() => expect(mockGetPage).toHaveBeenCalledWith(NAMESPACE, PUBLISH_NAME));
    await waitFor(() => expect(screen.getByTestId('layout').textContent).toBe(`${PUBLISH_NAME}:Fetched`));
  });
});
