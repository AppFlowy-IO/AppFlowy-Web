import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, Suspense } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { publishedDocumentPayload } from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';
import { INLINED_PUBLISH_SNAPSHOT_ID, releaseInlinedPublishSnapshot } from '@/application/publish-snapshot/inlined';
import type { PublishedPageSnapshot } from '@/application/publish-snapshot/types';
import { releaseServerRenderedMarkup } from '@/components/_shared/ServerRenderedFallback';

import PublishView from '../PublishView';

const mockGetPage = jest.fn<Promise<PublishedPageSnapshot>, [string, string]>();

jest.mock('@/application/publish-snapshot/data-source', () => ({
  createPublishSnapshotDataSource: () => ({ getPage: (...args: [string, string]) => mockGetPage(...args) }),
}));

jest.mock('@/application/publish', () => ({
  PublishProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/publish/PublishLayout', () => ({
  __esModule: true,
  default: ({ snapshot }: { snapshot?: PublishedPageSnapshot }) => (
    <div data-testid="layout">{snapshot ? `${snapshot.publishName}:${snapshot.view.name}` : 'loading'}</div>
  ),
}));

jest.mock('@/components/publish/PublishMobileLayout', () => ({
  __esModule: true,
  default: () => <div data-testid="mobile-layout" />,
}));

jest.mock('@/components/error/NotFound', () => ({
  __esModule: true,
  default: () => <div data-testid="not-found" />,
}));

jest.mock('@/utils/platform', () => ({
  getPlatform: () => ({ isMobile: false }),
}));

jest.mock('@/components/_shared/ServerRenderedFallback', () => ({
  releaseServerRenderedMarkup: jest.fn(),
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

const renderView = (publishName = PUBLISH_NAME) =>
  render(
    <MemoryRouter>
      <PublishView namespace={NAMESPACE} publishName={publishName} />
    </MemoryRouter>
  );

describe('PublishView with a server-inlined snapshot', () => {
  beforeEach(() => {
    mockGetPage.mockReset();
    mockGetPage.mockResolvedValue(fetchedSnapshot);
    releaseInlinedPublishSnapshot();
    jest.mocked(releaseServerRenderedMarkup).mockClear();
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
    expect(releaseServerRenderedMarkup).toHaveBeenCalled();
  });

  it('releases the server-rendered markup on a normal (non-SSR) load too', () => {
    renderView();

    expect(releaseServerRenderedMarkup).toHaveBeenCalled();
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
