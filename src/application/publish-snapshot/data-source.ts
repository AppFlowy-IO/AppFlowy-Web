import { createHttpJsonPublishSnapshotDataSource } from './http-json-adapter';
import type { PublishSnapshotDataSource } from './types';

export function createPublishSnapshotDataSource(): PublishSnapshotDataSource {
  return createHttpJsonPublishSnapshotDataSource();
}
