/**
 * Multipart upload implementation for large files (>=5MB)
 * Follows the same API patterns as the desktop AppFlowy implementation
 */

import { v4 as uuidv4 } from 'uuid';

import {
  getAppFlowyFileUrl,
  getMultipartCompleteUrl,
  getMultipartCreateUrl,
  getMultipartUploadPartUrl,
} from '@/utils/file-storage-url';
import { Log } from '@/utils/log';
import { getAxiosInstance } from './http_api';
import {
  CHUNK_SIZE,
  CreateUploadResponse,
  MAX_CONCURRENCY,
  MAX_RETRIES,
  UploadFileMultipartParams,
  UploadPartInfo,
} from './multipart-upload.types';

/**
 * Standard API response format
 */
interface APIResponse<T = unknown> {
  code: number;
  data?: T;
  message: string;
}

/**
 * Creates a multipart upload session
 */
async function createMultipartUpload(
  workspaceId: string,
  parentDir: string,
  file: File,
  fileId: string
): Promise<CreateUploadResponse> {
  const axiosInstance = getAxiosInstance();

  if (!axiosInstance) {
    throw new Error('API service not initialized');
  }

  const url = getMultipartCreateUrl(workspaceId);

  Log.debug('[createMultipartUpload]', { url, fileId, parentDir, fileSize: file.size });

  const response = await axiosInstance.post<APIResponse<CreateUploadResponse>>(url, {
    file_id: fileId,
    parent_dir: parentDir,
    content_type: file.type || 'application/octet-stream',
    file_size: file.size,
  });

  if (response.data.code !== 0 || !response.data.data) {
    throw new Error(response.data.message || 'Failed to create multipart upload');
  }

  return response.data.data;
}

/**
 * Uploads a single part with retry logic
 */
async function uploadPart(
  workspaceId: string,
  parentDir: string,
  fileId: string,
  uploadId: string,
  partNumber: number,
  chunk: Blob
): Promise<UploadPartInfo> {
  const axiosInstance = getAxiosInstance();

  if (!axiosInstance) {
    throw new Error('API service not initialized');
  }

  const url = getMultipartUploadPartUrl(workspaceId, parentDir, fileId, uploadId, partNumber);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      Log.debug('[uploadPart]', { partNumber, attempt, chunkSize: chunk.size });

      const arrayBuffer = await chunk.arrayBuffer();

      const response = await axiosInstance.put<APIResponse<{ e_tag: string; part_num: number }>>(
        url,
        arrayBuffer,
        {
          headers: {
            'Content-Type': 'application/octet-stream',
          },
        }
      );

      if (response.data.code !== 0 || !response.data.data) {
        throw new Error(response.data.message || `Failed to upload part ${partNumber}`);
      }

      return {
        part_number: partNumber,
        e_tag: response.data.data.e_tag,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      Log.debug('[uploadPart] retry', { partNumber, attempt, error: lastError.message });

      if (attempt < MAX_RETRIES) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error(`Failed to upload part ${partNumber} after ${MAX_RETRIES} attempts`);
}

/**
 * Completes the multipart upload
 */
async function completeMultipartUpload(
  workspaceId: string,
  parentDir: string,
  uploadId: string,
  fileId: string,
  parts: UploadPartInfo[]
): Promise<string> {
  const axiosInstance = getAxiosInstance();

  if (!axiosInstance) {
    throw new Error('API service not initialized');
  }

  const url = getMultipartCompleteUrl(workspaceId);

  Log.debug('[completeMultipartUpload]', { url, partsCount: parts.length });

  // Use PUT method and include all required fields in body
  const response = await axiosInstance.put<APIResponse>(url, {
    file_id: fileId,
    parent_dir: parentDir,
    upload_id: uploadId,
    parts: parts
      .sort((a, b) => a.part_number - b.part_number)
      .map((p) => ({
        e_tag: p.e_tag,
        part_number: p.part_number,
      })),
  });

  if (response.data.code !== 0) {
    throw new Error(response.data.message || 'Failed to complete multipart upload');
  }

  // Return the complete file URL
  return getAppFlowyFileUrl(workspaceId, parentDir, fileId);
}

/**
 * Promise pool for controlled concurrency
 * Executes tasks with a maximum number of concurrent operations
 */
async function executeWithConcurrency<T, R>(
  items: T[],
  maxConcurrency: number,
  executor: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function runNext(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];

      results[index] = await executor(item, index);
    }
  }

  // Start concurrent workers
  const workers = Array(Math.min(maxConcurrency, items.length))
    .fill(null)
    .map(() => runNext());

  await Promise.all(workers);

  return results;
}

/**
 * Main function to upload a file using multipart upload
 * Splits the file into chunks and uploads them in parallel
 */
export async function uploadFileMultipart({
  workspaceId,
  viewId,
  file,
  onProgress,
}: UploadFileMultipartParams): Promise<string> {
  Log.debug('[UploadFile] multipart starting', { fileName: file.name, fileSize: file.size });

  // Report initializing phase
  onProgress?.({
    phase: 'initializing',
    totalBytes: file.size,
    uploadedBytes: 0,
    percentage: 0,
  });

  // Generate a unique file ID
  const fileId = uuidv4();
  const parentDir = viewId;

  // Step 1: Create upload session
  const { upload_id: uploadId } = await createMultipartUpload(workspaceId, parentDir, file, fileId);

  Log.debug('[UploadFile] multipart upload created', { uploadId, fileId });

  // Step 2: Split file into chunks
  const chunks: { partNumber: number; blob: Blob }[] = [];
  let offset = 0;
  let partNumber = 1;

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const blob = file.slice(offset, end);

    chunks.push({ partNumber, blob });
    offset = end;
    partNumber++;
  }

  Log.debug('[UploadFile] multipart chunks created', { totalChunks: chunks.length });

  // Step 3: Upload parts with concurrency control
  let uploadedBytes = 0;
  const totalBytes = file.size;

  const parts = await executeWithConcurrency(chunks, MAX_CONCURRENCY, async (chunk) => {
    const result = await uploadPart(
      workspaceId,
      parentDir,
      fileId,
      uploadId,
      chunk.partNumber,
      chunk.blob
    );

    // Update progress after each part completes
    uploadedBytes += chunk.blob.size;
    onProgress?.({
      phase: 'uploading',
      totalBytes,
      uploadedBytes,
      percentage: Math.round((uploadedBytes / totalBytes) * 100),
    });

    return result;
  });

  Log.debug('[UploadFile] multipart all parts uploaded', { partsCount: parts.length });

  // Step 4: Complete the upload
  onProgress?.({
    phase: 'completing',
    totalBytes,
    uploadedBytes: totalBytes,
    percentage: 100,
  });

  const fileUrl = await completeMultipartUpload(workspaceId, parentDir, uploadId, fileId, parts);

  Log.debug('[UploadFile] multipart completed', { fileUrl });

  return fileUrl;
}
