import axios from 'axios';

import {
  DatabaseCsvImportCreateResponse,
  DatabaseCsvImportRequest,
  DatabaseCsvImportStatusResponse,
} from '@/application/types';
import { Log } from '@/utils/log';
import { getConfigValue } from '@/utils/runtime-config';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

export async function createImportTask(file: File) {
  const url = `/api/import/create`;
  const fileName = file.name.split('.').slice(0, -1).join('.') || crypto.randomUUID();

  return executeAPIRequest<{ task_id: string; presigned_url: string }>(() =>
    getAxios()?.post<APIResponse<{ task_id: string; presigned_url: string }>>(url, {
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

  if (response.status === 200) {
    return;
  }

  return Promise.reject({
    code: -1,
    message: `Upload file failed. ${response.statusText}`,
  });
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
