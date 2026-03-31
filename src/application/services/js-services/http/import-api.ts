import axios from 'axios';

import {
  DatabaseCsvImportCreateResponse,
  DatabaseCsvImportRequest,
  DatabaseCsvImportStatusResponse,
} from '@/application/types';
import { Log } from '@/utils/log';
import { getConfigValue } from '@/utils/runtime-config';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

export interface ImportPartPresignedUrl {
  part_number: number;
  presigned_url: string;
}

export interface ImportMultipartUploadInfo {
  upload_id: string;
  s3_key: string;
  part_presigned_urls: ImportPartPresignedUrl[];
}

interface CreateImportTaskRaw {
  task_id: string;
  presigned_url: string;
  multipart?: ImportMultipartUploadInfo | null;
}

export async function createImportTask(file: File) {
  const url = `/api/import/create`;
  const fileName = file.name.split('.').slice(0, -1).join('.') || crypto.randomUUID();

  return executeAPIRequest<CreateImportTaskRaw>(() =>
    getAxios()?.post<APIResponse<CreateImportTaskRaw>>(url, {
      workspace_name: fileName,
      content_length: file.size,
    }, {
      headers: {
        'X-Host': getConfigValue('APPFLOWY_BASE_URL', ''),
      },
    })
  ).then((data) => ({
    taskId: data.task_id,
    presignedUrl: data.presigned_url,
    multipart: data.multipart ?? null,
  }));
}

export async function uploadImportFile(presignedUrl: string, file: File, onProgress: (progress: number) => void) {
  const response = await axios.put(presignedUrl, file, {
    onUploadProgress: (progressEvent) => {
      const { progress = 0 } = progressEvent;

      Log.debug(`Upload progress: ${progress * 100}%`);
      onProgress(progress);
    },
    headers: {
      'Content-Type': 'application/zip',
    },
  });

  if (response.status === 200 || response.status === 204) {
    return;
  }

  return Promise.reject({
    code: -1,
    message: `Upload file failed. ${response.statusText}`,
  });
}

/**
 * Upload a file using multipart presigned URLs, then complete the upload.
 * Parts are uploaded with limited concurrency; progress is reported smoothly.
 */
export async function uploadImportFileMultipart(
  file: File,
  multipart: ImportMultipartUploadInfo,
  onProgress: (progress: number) => void,
) {
  const MAX_CONCURRENCY = 5;
  const partCount = multipart.part_presigned_urls.length;
  const partSize = Math.ceil(file.size / partCount);

  const bytesUploaded = new Array<number>(partCount).fill(0);
  const completedParts: { e_tag: string; part_number: number }[] = [];
  let aborted = false;

  const reportProgress = () => {
    const total = bytesUploaded.reduce((sum, b) => sum + b, 0);

    onProgress(total / file.size);
  };

  const uploadPart = async (i: number) => {
    if (aborted) return;

    const partInfo = multipart.part_presigned_urls[i];
    const start = (partInfo.part_number - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const blob = file.slice(start, end);

    const resp = await axios.put(partInfo.presigned_url, blob, {
      validateStatus: () => true,
      onUploadProgress: (progressEvent) => {
        bytesUploaded[i] = progressEvent.loaded ?? 0;
        reportProgress();
      },
    });

    if (resp.status < 200 || resp.status >= 300) {
      aborted = true;
      return Promise.reject({
        code: -1,
        message: `Multipart upload failed for part ${partInfo.part_number}. ${resp.statusText}`,
      });
    }

    const eTag = (resp.headers['etag'] as string | undefined)?.replace(/"/g, '');

    if (!eTag) {
      aborted = true;
      return Promise.reject({
        code: -1,
        message: `Missing ETag in response for part ${partInfo.part_number}`,
      });
    }

    completedParts.push({ e_tag: eTag, part_number: partInfo.part_number });
  };

  // Upload parts with limited concurrency
  const queue = Array.from({ length: partCount }, (_, i) => i);
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, partCount) }, async () => {
    while (queue.length > 0 && !aborted) {
      const idx = queue.shift()!;

      await uploadPart(idx);
    }
  });

  await Promise.all(workers);

  // Complete the multipart upload on the server
  await completeImportMultipart({
    s3_key: multipart.s3_key,
    upload_id: multipart.upload_id,
    parts: completedParts.sort((a, b) => a.part_number - b.part_number),
  });
}

async function completeImportMultipart(data: {
  s3_key: string;
  upload_id: string;
  parts: { e_tag: string; part_number: number }[];
}) {
  const url = `/api/import/complete-multipart`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, data)
  );
}

export async function createDatabaseCsvImportTask(
  workspaceId: string,
  payload: DatabaseCsvImportRequest
): Promise<DatabaseCsvImportCreateResponse> {
  const url = `/api/workspace/${workspaceId}/database/import/csv`;

  return executeAPIRequest<DatabaseCsvImportCreateResponse>(() =>
    getAxios()?.post<APIResponse<DatabaseCsvImportCreateResponse>>(url, payload, {
      headers: {
        'X-Host': getConfigValue('APPFLOWY_BASE_URL', ''),
      },
    })
  );
}

export async function uploadDatabaseCsvImportFile(
  presignedUrl: string,
  file: File,
  onProgress?: (progress: number) => void
) {
  const response = await axios.put(presignedUrl, file, {
    onUploadProgress: (progressEvent) => {
      if (!onProgress) return;
      const { progress = 0 } = progressEvent;

      Log.debug(`Upload progress: ${progress * 100}%`);
      onProgress(progress);
    },
    headers: {
      'Content-Type': 'text/csv',
    },
  });

  if (response.status === 200 || response.status === 204) {
    return;
  }

  return Promise.reject({
    code: -1,
    message: `Upload csv file failed. ${response.statusText}`,
  });
}

export async function getDatabaseCsvImportStatus(
  workspaceId: string,
  taskId: string
): Promise<DatabaseCsvImportStatusResponse> {
  const url = `/api/workspace/${workspaceId}/database/import/csv/${taskId}`;

  return executeAPIRequest<DatabaseCsvImportStatusResponse>(() =>
    getAxios()?.get<APIResponse<DatabaseCsvImportStatusResponse>>(url)
  );
}

export async function cancelDatabaseCsvImportTask(workspaceId: string, taskId: string): Promise<void> {
  const url = `/api/workspace/${workspaceId}/database/import/csv/${taskId}/cancel`;

  return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url));
}
