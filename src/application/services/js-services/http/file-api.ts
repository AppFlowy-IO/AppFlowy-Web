import { ERROR_CODE } from '@/application/constants';
import { getAppFlowyFileUploadUrl, getAppFlowyFileUrl } from '@/utils/file-storage-url';
import { Log } from '@/utils/log';
import { isAppFlowyHosted } from '@/utils/subscription';

import { getAxios, handleAPIError } from './core';

export { uploadFileMultipart } from './multipart-upload';
export { MULTIPART_THRESHOLD } from './multipart-upload.types';
export type { MultipartUploadProgress } from './multipart-upload.types';

export async function uploadFile(
  workspaceId: string,
  viewId: string,
  file: File,
  onProgress?: (progress: number) => void
) {
  Log.debug('[UploadFile] starting', { fileName: file.name, fileSize: file.size });
  const url = getAppFlowyFileUploadUrl(workspaceId, viewId);

  const axiosInstance = getAxios();

  try {
    const response = await axiosInstance?.put<{
      code: number;
      message: string;
      data: {
        file_id: string;
      };
    }>(url, file, {
      onUploadProgress: (progressEvent) => {
        const { progress = 0 } = progressEvent;

        onProgress?.(progress);
      },
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
    });

    if (response?.data.code === 0) {
      Log.debug('[UploadFile] completed', { url });
      return getAppFlowyFileUrl(workspaceId, viewId, response?.data.data.file_id);
    }

    return Promise.reject(response?.data);
    // eslint-disable-next-line
  } catch (e: any) {
    if (e.response?.status === 413) {
      return Promise.reject({
        code: ERROR_CODE.PAYLOAD_TOO_LARGE,
        message: isAppFlowyHosted()
          ? 'File size is too large. Please upgrade your plan for unlimited uploads.'
          : 'File size is too large.',
      });
    }

    return Promise.reject(handleAPIError(e));
  }
}
