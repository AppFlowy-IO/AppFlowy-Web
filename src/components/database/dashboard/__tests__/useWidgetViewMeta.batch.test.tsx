import { act, render, screen, waitFor } from '@testing-library/react';
import { EventEmitter } from 'events';
import { ReactNode } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { LoadViewMeta, UIVariant, View, ViewLayout } from '@/application/types';

import { DashboardHostContext, DashboardHostServices } from '../DashboardUiContext';
import { useWidgetViewMeta } from '../hooks/useWidgetViewMeta';

/** The views the app's view cache holds (the per-view load answers them from it). */
const mockCachedViews = new Map<string, View>();
/** The views the flat metadata index holds (the outline fills it; `metadataOnly` reads it). */
const mockIndexedViews = new Map<string, View>();
const mockGetMultiple = jest.fn<Promise<View[]>, [string, string[], number]>();

jest.mock('@/application/services/domains', () => ({
  ViewService: {
    getMultiple: (...args: [string, string[], number]) => mockGetMultiple(...args),
    getCached: (_workspaceId: string, viewId: string) => mockCachedViews.get(viewId),
    getCachedMetadata: (_workspaceId: string, viewId: string) => mockIndexedViews.get(viewId),
  },
}));

const WORKSPACE_ID = 'workspace';

function folderView(viewId: string, name = `Folder ${viewId}`): View {
  return {
    view_id: viewId,
    name,
    icon: null,
    layout: ViewLayout.Grid,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
  };
}

/** The twelve widget views of a full dashboard. */
const VIEW_IDS = Array.from({ length: 12 }, (_, index) => `view-${index + 1}`);

interface Host {
  services: DashboardHostServices;
  eventEmitter: EventEmitter;
  /** The per-view load (`GET /view/{id}?depth=1` in the app). */
  loadViewMeta: jest.Mock<ReturnType<LoadViewMeta>, Parameters<LoadViewMeta>>;
}

function createHost(variant: UIVariant = UIVariant.App): Host {
  const eventEmitter = new EventEmitter();
  const loadViewMeta = jest.fn<ReturnType<LoadViewMeta>, Parameters<LoadViewMeta>>(async (viewId) =>
    folderView(viewId, `Alone ${viewId}`)
  );
  const services = {
    eventEmitter,
    loadViewMeta,
    variant,
    workspaceId: WORKSPACE_ID,
  } as unknown as DashboardHostServices;

  return { services, eventEmitter, loadViewMeta };
}

function WidgetTitle({ viewId }: { viewId: string }) {
  const { name } = useWidgetViewMeta(viewId);

  return <span data-testid={`title-${viewId}`}>{name}</span>;
}

function Dashboard({ host, viewIds = VIEW_IDS }: { host: Host; viewIds?: string[] }): ReactNode {
  return (
    <DashboardHostContext.Provider value={host.services}>
      {viewIds.map((viewId) => (
        <WidgetTitle key={viewId} viewId={viewId} />
      ))}
    </DashboardHostContext.Provider>
  );
}

function title(viewId: string) {
  return screen.getByTestId(`title-${viewId}`).textContent;
}

/** Every view-meta request the dashboard sent: batched ones and per-view ones. */
function requestCount(host: Host) {
  return mockGetMultiple.mock.calls.length + host.loadViewMeta.mock.calls.length;
}

beforeEach(() => {
  mockCachedViews.clear();
  mockIndexedViews.clear();
  mockGetMultiple.mockReset();
  mockGetMultiple.mockImplementation(async (_workspaceId, viewIds) => viewIds.map((viewId) => folderView(viewId)));
});

describe('useWidgetViewMeta on a dashboard', () => {
  it('sends at most 1 request for 12 widgets mounted together', async () => {
    const host = createHost();

    render(<Dashboard host={host} />);

    await waitFor(() => expect(VIEW_IDS.map(title)).toEqual(VIEW_IDS.map((viewId) => `Folder ${viewId}`)));
    expect(requestCount(host)).toBeLessThanOrEqual(1);
    expect(mockGetMultiple).toHaveBeenCalledTimes(1);
    expect(mockGetMultiple).toHaveBeenCalledWith(WORKSPACE_ID, VIEW_IDS, 1);
    expect(host.loadViewMeta).not.toHaveBeenCalled();
  });

  it('falls back to the per-view load for every view when the batch fails', async () => {
    const host = createHost();

    mockGetMultiple.mockRejectedValue(new Error('offline'));
    render(<Dashboard host={host} />);

    await waitFor(() => expect(VIEW_IDS.map(title)).toEqual(VIEW_IDS.map((viewId) => `Alone ${viewId}`)));
    expect(mockGetMultiple).toHaveBeenCalledTimes(1);
    expect(host.loadViewMeta.mock.calls.map(([viewId]) => viewId).sort()).toEqual([...VIEW_IDS].sort());
  });

  it('asks the per-view load for a view the batch leaves out, and only for it', async () => {
    const host = createHost();

    // view-3 was deleted or is not shared with this user: the batch leaves it out.
    mockGetMultiple.mockImplementation(async (_workspaceId, viewIds) =>
      viewIds.filter((viewId) => viewId !== 'view-3').map((viewId) => folderView(viewId))
    );
    host.loadViewMeta.mockImplementation(async () => null);
    render(<Dashboard host={host} />);

    await waitFor(() => expect(title('view-12')).toBe('Folder view-12'));
    await waitFor(() => expect(host.loadViewMeta).toHaveBeenCalled());
    expect(new Set(host.loadViewMeta.mock.calls.map(([viewId]) => viewId))).toEqual(new Set(['view-3']));
    expect(title('view-3')).toBe('');
  });

  it('leaves a view in the app view cache to the per-view load, and batches the others', async () => {
    const host = createHost();

    mockCachedViews.set('view-1', folderView('view-1'));
    render(<Dashboard host={host} />);

    await waitFor(() => expect(VIEW_IDS.map(title).every((name) => name !== '')).toBe(true));
    expect(mockGetMultiple).toHaveBeenCalledTimes(1);
    expect(mockGetMultiple.mock.calls[0][1]).toEqual(VIEW_IDS.slice(1));
    expect(host.loadViewMeta.mock.calls).toEqual([['view-1']]);
  });

  it('reads the views of the metadata index through the app load with metadataOnly, without any request', async () => {
    const host = createHost();

    // The outline holds every view of the dashboard: the plain per-view load would ask the server for each.
    VIEW_IDS.forEach((viewId) => mockIndexedViews.set(viewId, folderView(viewId)));
    render(<Dashboard host={host} />);

    await waitFor(() => expect(VIEW_IDS.map(title)).toEqual(VIEW_IDS.map((viewId) => `Alone ${viewId}`)));
    expect(mockGetMultiple).not.toHaveBeenCalled();
    expect(host.loadViewMeta.mock.calls).toEqual(VIEW_IDS.map((viewId) => [viewId, undefined, { metadataOnly: true }]));
  });

  it('keeps the per-view load for a lone widget and on a published page', async () => {
    const lone = createHost();
    const { unmount } = render(<Dashboard host={lone} viewIds={['view-1']} />);

    await waitFor(() => expect(title('view-1')).toBe('Alone view-1'));
    unmount();

    const published = createHost(UIVariant.Publish);

    render(<Dashboard host={published} />);
    await waitFor(() => expect(VIEW_IDS.map(title)).toEqual(VIEW_IDS.map((viewId) => `Alone ${viewId}`)));
    expect(mockGetMultiple).not.toHaveBeenCalled();
    expect(published.loadViewMeta).toHaveBeenCalledTimes(VIEW_IDS.length);
  });

  it('still follows a rename after the batched load', async () => {
    const host = createHost();

    render(<Dashboard host={host} />);
    await waitFor(() => expect(title('view-5')).toBe('Folder view-5'));

    act(() => {
      host.eventEmitter.emit(APP_EVENTS.VIEW_META_CHANGED, folderView('view-5', 'Renamed'));
    });

    expect(title('view-5')).toBe('Renamed');
    expect(title('view-6')).toBe('Folder view-6');
    expect(requestCount(host)).toBe(1);
  });
});
