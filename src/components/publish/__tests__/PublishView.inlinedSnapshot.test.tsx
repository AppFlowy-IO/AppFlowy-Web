import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { publishedDocumentPayload } from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';
import type { PublishedPageSnapshot } from '@/application/publish-snapshot/types';

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
    delete window.__APPFLOWY_PUBLISH_SNAPSHOT__;
  });

  it('renders the inlined snapshot immediately and does not fetch', async () => {
    window.__APPFLOWY_PUBLISH_SNAPSHOT__ = publishedDocumentPayload;

    renderView();

    expect(screen.getByTestId('layout').textContent).toBe(`${PUBLISH_NAME}:Published document`);
    // Give any stray effect a chance to run before asserting it did not fetch.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockGetPage).not.toHaveBeenCalled();
    expect(window.__APPFLOWY_PUBLISH_SNAPSHOT__).toBeUndefined();
  });

  it('fetches when no snapshot is inlined', async () => {
    renderView();

    expect(screen.getByTestId('layout').textContent).toBe('loading');
    await waitFor(() => expect(screen.getByTestId('layout').textContent).toBe(`${PUBLISH_NAME}:Fetched`));
    expect(mockGetPage).toHaveBeenCalledWith(NAMESPACE, PUBLISH_NAME);
  });

  it('fetches when the inlined snapshot belongs to another page', async () => {
    window.__APPFLOWY_PUBLISH_SNAPSHOT__ = { ...publishedDocumentPayload, publishName: 'other-page' };

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
  ])('falls back to fetching when the global is %s', async (_label, value) => {
    window.__APPFLOWY_PUBLISH_SNAPSHOT__ = value;

    renderView();

    await waitFor(() => expect(screen.getByTestId('layout').textContent).toBe(`${PUBLISH_NAME}:Fetched`));
    expect(mockGetPage).toHaveBeenCalledTimes(1);
  });

  it('fetches normally after navigating to another page', async () => {
    window.__APPFLOWY_PUBLISH_SNAPSHOT__ = publishedDocumentPayload;

    const { rerender } = renderView();

    expect(mockGetPage).not.toHaveBeenCalled();

    rerender(
      <MemoryRouter>
        <PublishView namespace={NAMESPACE} publishName="next-page" />
      </MemoryRouter>
    );

    await waitFor(() => expect(mockGetPage).toHaveBeenCalledWith(NAMESPACE, 'next-page'));
  });
});
