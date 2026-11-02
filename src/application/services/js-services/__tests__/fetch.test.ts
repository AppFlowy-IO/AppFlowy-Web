import { expect } from '@jest/globals';
import { fetchPublishView, fetchPublishViewMeta, fetchRowDocumentCollab, fetchViewInfo } from '../fetch';
import {
  getCollab,
  getPublishView,
  getPublishInfoWithViewId,
  getPublishViewMeta,
} from '@/application/services/js-services/http';
import { Types } from '@/application/types';

jest.mock('@/application/services/js-services/http', () => {
  return {
    getPublishView: jest.fn(),
    getPublishViewMeta: jest.fn(),
    getPublishInfoWithViewId: jest.fn(),
    getPageCollab: jest.fn(),
    getCollab: jest.fn(),
  };
});

describe('Collab fetch functions with deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchPublishView', () => {
    it('should fetch publish view without duplicating requests', async () => {
      const namespace = 'namespace1';
      const publishName = 'publish1';
      const mockResponse = { data: 'mockData' };

      (getPublishView as jest.Mock).mockResolvedValue(mockResponse);

      const result1 = fetchPublishView(namespace, publishName);
      const result2 = fetchPublishView(namespace, publishName);

      expect(result1).toBe(result2);
      await expect(result1).resolves.toEqual(mockResponse);
      expect(getPublishView).toHaveBeenCalledTimes(1);
    });

    it('should fetch publish view with different params', async () => {
      const namespace = 'namespace1';
      const publishName = 'publish1';
      const mockResponse = { data: 'mockData' };

      (getPublishView as jest.Mock).mockResolvedValue(mockResponse);

      const result1 = fetchPublishView(namespace, publishName);
      const result2 = fetchPublishView(namespace, 'publish2');

      expect(result1).not.toBe(result2);
      await expect(result1).resolves.toEqual(mockResponse);
      await expect(result2).resolves.toEqual(mockResponse);
      expect(getPublishView).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchViewInfo', () => {
    it('should fetch view info without duplicating requests', async () => {
      const viewId = 'view1';
      const mockResponse = { data: 'mockData' };

      (getPublishInfoWithViewId as jest.Mock).mockResolvedValue(mockResponse);

      const result1 = fetchViewInfo(viewId);
      const result2 = fetchViewInfo(viewId);

      expect(result1).toBe(result2);
      await expect(result1).resolves.toEqual(mockResponse);
      expect(getPublishInfoWithViewId).toHaveBeenCalledTimes(1);
    });

    it('should fetch view info with different params', async () => {
      const viewId = 'view1';
      const mockResponse = { data: 'mockData' };

      (getPublishInfoWithViewId as jest.Mock).mockResolvedValue(mockResponse);

      const result1 = fetchViewInfo(viewId);
      const result2 = fetchViewInfo('view2');

      expect(result1).not.toBe(result2);
      await expect(result1).resolves.toEqual(mockResponse);
      await expect(result2).resolves.toEqual(mockResponse);
      expect(getPublishInfoWithViewId).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchRowDocumentCollab', () => {
    it('deduplicates contextual row-document requests', async () => {
      const source = {
        database_id: 'database-1',
        database_view_id: 'database-view-1',
        row_id: 'row-1',
      };
      const mockResponse = { data: new Uint8Array([1, 2, 3]) };

      (getCollab as jest.Mock).mockResolvedValue(mockResponse);

      const result1 = fetchRowDocumentCollab('workspace-1', 'document-1', source);
      const result2 = fetchRowDocumentCollab('workspace-1', 'document-1', { ...source });

      expect(result1).toBe(result2);
      await expect(result1).resolves.toEqual(mockResponse);
      expect(getCollab).toHaveBeenCalledTimes(1);
      expect(getCollab).toHaveBeenCalledWith('workspace-1', 'document-1', Types.Document, source);
    });
  });

  describe('fetchPublishViewMeta', () => {
    it('should fetch publish view meta without duplicating requests', async () => {
      const namespace = 'namespace1';
      const publishName = 'publish1';
      const mockResponse = { data: 'mockData' };

      (getPublishViewMeta as jest.Mock).mockResolvedValue(mockResponse);

      const result1 = fetchPublishViewMeta(namespace, publishName);
      const result2 = fetchPublishViewMeta(namespace, publishName);

      expect(result1).toBe(result2);
      await expect(result1).resolves.toEqual(mockResponse);
      expect(getPublishViewMeta).toHaveBeenCalledTimes(1);
    });

    it('should fetch publish view meta with different params', async () => {
      const namespace = 'namespace1';
      const publishName = 'publish1';
      const mockResponse = { data: 'mockData' };

      (getPublishViewMeta as jest.Mock).mockResolvedValue(mockResponse);

      const result1 = fetchPublishViewMeta(namespace, publishName);
      const result2 = fetchPublishViewMeta(namespace, 'publish2');

      expect(result1).not.toBe(result2);
      await expect(result1).resolves.toEqual(mockResponse);
      await expect(result2).resolves.toEqual(mockResponse);
      expect(getPublishViewMeta).toHaveBeenCalledTimes(2);
    });
  });
});

describe('cancellable database reads', () => {
  it('cancels the transport only after the last widget leaves, then starts a fresh request', async () => {
    const { fetchDatabaseCollab } = await import('../fetch');
    const signals: AbortSignal[] = [];
    const resolvers: ((result: { data: Uint8Array }) => void)[] = [];

    jest.mocked(getCollab).mockImplementation((_workspace, _database, _type, _source, signal) => {
      signals.push(signal!);
      return new Promise((resolve) => resolvers.push(resolve));
    });
    const first = new AbortController();
    const second = new AbortController();
    const a = fetchDatabaseCollab('workspace-cancel', 'database', first.signal);
    const b = fetchDatabaseCollab('workspace-cancel', 'database', second.signal);
    const cancelledA = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    const cancelledB = expect(b).rejects.toMatchObject({ name: 'AbortError' });

    await Promise.resolve();
    expect(signals).toHaveLength(1);
    first.abort();
    await cancelledA;
    expect(signals[0].aborted).toBe(false);
    second.abort();
    await cancelledB;
    expect(signals[0].aborted).toBe(true);

    const resumed = fetchDatabaseCollab('workspace-cancel', 'database');

    await Promise.resolve();
    expect(signals).toHaveLength(2);
    // An old transport that ignores cancellation cannot evict the new request.
    resolvers[0]({ data: new Uint8Array([0]) });
    await Promise.resolve();
    await Promise.resolve();
    const joined = fetchDatabaseCollab('workspace-cancel', 'database');

    resolvers[1]({ data: new Uint8Array([1]) });
    await expect(resumed).resolves.toEqual({ data: new Uint8Array([1]) });
    await expect(joined).resolves.toEqual({ data: new Uint8Array([1]) });
    expect(signals).toHaveLength(2);
  });

  it('keeps a shared page request alive for a non-cancellable reader', async () => {
    const { fetchPageCollab } = await import('../fetch');
    const { getPageCollab } = await import('@/application/services/js-services/http');
    let transportSignal: AbortSignal | undefined;
    let finish!: (result: Awaited<ReturnType<typeof getPageCollab>>) => void;

    jest.mocked(getPageCollab).mockImplementation((_workspace, _view, signal) => {
      transportSignal = signal;
      return new Promise((resolve) => { finish = resolve; });
    });
    const controller = new AbortController();
    const widget = fetchPageCollab('workspace-page-cancel', 'view', controller.signal);
    const page = fetchPageCollab('workspace-page-cancel', 'view');
    const cancelled = expect(widget).rejects.toMatchObject({ name: 'AbortError' });

    await Promise.resolve();
    controller.abort();
    await cancelled;
    expect(transportSignal?.aborted).toBe(false);
    const response = { data: new Uint8Array([1]), rows: {}, owner: undefined, lastEditor: undefined };

    finish(response);
    await expect(page).resolves.toEqual(response);
  });
});
