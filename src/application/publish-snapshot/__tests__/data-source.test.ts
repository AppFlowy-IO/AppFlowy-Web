import { createPublishSnapshotDataSource } from '@/application/publish-snapshot/data-source';
import { JsonPublishSnapshotDataSource } from '@/application/publish-snapshot/json-api-adapter';

describe('createPublishSnapshotDataSource', () => {
  it('uses the v2 JSON snapshot API data source', () => {
    const dataSource = createPublishSnapshotDataSource();

    expect(dataSource).toBeInstanceOf(JsonPublishSnapshotDataSource);
  });
});
