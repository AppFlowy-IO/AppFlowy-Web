import type { PublishedPageSnapshot, PublishedPageSnapshotPayload, PublishSnapshotDataSource } from './types';
import { normalizePublishedPageSnapshot } from './normalize';

export type FetchPublishedPageSnapshot = (
  namespace: string,
  publishName: string
) => Promise<PublishedPageSnapshotPayload>;

export class JsonPublishSnapshotDataSource implements PublishSnapshotDataSource {
  constructor(private readonly fetchPage: FetchPublishedPageSnapshot) {}

  async getPage(namespace: string, publishName: string): Promise<PublishedPageSnapshot> {
    const snapshot = await this.fetchPage(namespace, publishName);

    return normalizePublishedPageSnapshot(snapshot);
  }
}

export function createJsonPublishSnapshotDataSource(
  fetchPage: FetchPublishedPageSnapshot
): JsonPublishSnapshotDataSource {
  return new JsonPublishSnapshotDataSource(fetchPage);
}
