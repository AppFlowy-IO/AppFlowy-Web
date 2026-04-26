import { APIResponse, executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';

import {
  createJsonPublishSnapshotDataSource,
  JsonPublishSnapshotDataSource,
  type FetchPublishedPageSnapshot,
} from './json-api-adapter';
import type { PublishedPageSnapshotPayload } from './types';

export function getPublishedPageSnapshotEndpoint(namespace: string, publishName: string): string {
  return `/api/workspace/v2/published/${encodeURIComponent(namespace)}/${encodeURIComponent(publishName)}/snapshot`;
}

export async function fetchPublishedPageSnapshot(
  namespace: string,
  publishName: string
): Promise<PublishedPageSnapshotPayload> {
  const url = getPublishedPageSnapshotEndpoint(namespace, publishName);

  return executeAPIRequest<PublishedPageSnapshotPayload>(() =>
    getAxios()?.get<APIResponse<PublishedPageSnapshotPayload>>(url)
  );
}

export function createHttpJsonPublishSnapshotDataSource(
  fetchPage: FetchPublishedPageSnapshot = fetchPublishedPageSnapshot
): JsonPublishSnapshotDataSource {
  return createJsonPublishSnapshotDataSource(fetchPage);
}
