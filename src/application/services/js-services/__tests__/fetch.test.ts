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
