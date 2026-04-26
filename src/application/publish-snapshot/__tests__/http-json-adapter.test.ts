import { ViewLayout } from '@/application/types';
import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';
import {
  createHttpJsonPublishSnapshotDataSource,
  fetchPublishedPageSnapshot,
  getPublishedPageSnapshotEndpoint,
} from '@/application/publish-snapshot/http-json-adapter';
import { publishedDocumentPayload } from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';

jest.mock('@/application/services/js-services/http/core', () => ({
  executeAPIRequest: jest.fn(),
  getAxios: jest.fn(),
}));

const mockExecuteAPIRequest = executeAPIRequest as unknown as jest.Mock;
const mockGetAxios = getAxios as unknown as jest.Mock;
const mockGet = jest.fn();

describe('http JSON publish snapshot adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({
      data: {
        code: 0,
        message: '',
        data: publishedDocumentPayload,
      },
    });
    mockGetAxios.mockReturnValue({ get: mockGet });
    mockExecuteAPIRequest.mockImplementation(async (request: () => Promise<{ data: { data: unknown } }>) => {
      const response = await request();

      return response.data.data;
    });
  });

  it('builds the future JSON snapshot endpoint with encoded path segments', () => {
    expect(getPublishedPageSnapshotEndpoint('team space', 'document/page')).toBe(
      '/api/workspace/v2/published/team%20space/document%2Fpage/snapshot'
    );
  });

  it('fetches a publish snapshot payload through the standard API envelope', async () => {
    await expect(fetchPublishedPageSnapshot('team space', 'document/page')).resolves.toBe(publishedDocumentPayload);

    expect(mockExecuteAPIRequest).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/workspace/v2/published/team%20space/document%2Fpage/snapshot');
  });

  it('creates a data source that normalizes sparse JSON payloads', async () => {
    const dataSource = createHttpJsonPublishSnapshotDataSource(async () => ({
      schemaVersion: 1,
      kind: 'document',
      namespace: 'namespace',
      publishName: 'publish-name',
      view: {
        viewId: 'view-id',
        name: 'Document',
        icon: null,
        extra: null,
        layout: ViewLayout.Document,
      },
    }));

    await expect(dataSource.getPage('namespace', 'publish-name')).resolves.toMatchObject({
      view: {
        childViews: [],
        ancestorViews: [],
        visibleViewIds: [],
        databaseRelations: {},
      },
      document: {
        children: [],
      },
    });
  });
});
