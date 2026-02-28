import { notify } from '@/components/_shared/notify';
import { getAppFlowyFileUploadUrl, getAppFlowyFileUrl } from '@/utils/file-storage-url';
import { Log } from '@/utils/log';
import { hasProAccessFromPlans } from '@/utils/subscription';

import { getAxios, handleAPIError } from './core';
import { getActiveSubscription } from './billing-api';

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

  // Check file size, if over 7MB, check subscription plan
  if (file.size > 7 * 1024 * 1024) {
    const plan = await getActiveSubscription(workspaceId);

    if (!hasProAccessFromPlans(plan)) {
      notify.error('Your file is over 7 MB limit of the Free plan. Upgrade for unlimited uploads.');

      return Promise.reject({
        code: 413,
        message: 'File size is too large. Please upgrade your plan for unlimited uploads.',
      });
    }
  }

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
        code: 413,
        message: 'File size is too large. Please upgrade your plan for unlimited uploads.',
      });
    }

    return Promise.reject(handleAPIError(e));
  }
}
