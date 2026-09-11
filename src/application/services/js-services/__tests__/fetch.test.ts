import { expect } from '@jest/globals';
import {
  fetchPageCollab,
  fetchPublishView,
  fetchPublishViewMeta,
  fetchRowDocumentCollab,
  fetchViewInfo,
} from '../fetch';
import {
  getCollab,
  getPageCollab,
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

  describe('fetchPageCollab', () => {
    it('normalizes omitted and explicit full-row options for deduplication', async () => {
      const response = { data: new Uint8Array([1]), rows: { 'row-id': [2] } };

      jest.mocked(getPageCollab).mockResolvedValue(response);

      const defaultRequest = fetchPageCollab('workspace-id', 'view-id');
      const explicitRequest = fetchPageCollab('workspace-id', 'view-id', { includeRows: true });

      expect(defaultRequest).toBe(explicitRequest);
      await expect(defaultRequest).resolves.toEqual(response);
      expect(getPageCollab).toHaveBeenCalledTimes(1);
      expect(getPageCollab).toHaveBeenCalledWith('workspace-id', 'view-id', { includeRows: true });
    });

    it('deduplicates no-row loads without sharing their response with full-row callers', async () => {
      const fullResponse = { data: new Uint8Array([1]), rows: { 'row-id': [2] } };
      const noRowsResponse = { data: new Uint8Array([1]), rows: {} };

      jest.mocked(getPageCollab).mockImplementation(async (_workspaceId, _viewId, options) => {
        return options?.includeRows === false ? noRowsResponse : fullResponse;
      });

      const noRowsRequest = fetchPageCollab('workspace-id', 'view-id', { includeRows: false });
      const duplicateNoRowsRequest = fetchPageCollab('workspace-id', 'view-id', { includeRows: false });
      const fullRequest = fetchPageCollab('workspace-id', 'view-id');

      expect(noRowsRequest).toBe(duplicateNoRowsRequest);
      expect(noRowsRequest).not.toBe(fullRequest);
      await expect(noRowsRequest).resolves.toEqual(noRowsResponse);
      await expect(fullRequest).resolves.toEqual(fullResponse);
      expect(getPageCollab).toHaveBeenCalledTimes(2);
      expect(getPageCollab).toHaveBeenCalledWith('workspace-id', 'view-id', { includeRows: false });
      expect(getPageCollab).toHaveBeenCalledWith('workspace-id', 'view-id', { includeRows: true });
    });
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
