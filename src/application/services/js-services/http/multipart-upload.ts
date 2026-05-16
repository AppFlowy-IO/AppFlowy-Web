/**
 * Multipart upload implementation for large files (>=5MB)
 * Follows the same API patterns as the desktop AppFlowy implementation
 */

import { v4 as uuidv4 } from 'uuid';

import {
  getAppFlowyFileUrl,
  getMultipartAbortUrl,
  getMultipartCompleteUrl,
  getMultipartCreateUrl,
  getMultipartUploadedPartsUrl,
  getMultipartUploadPartUrl,
} from '@/utils/file-storage-url';
import { Log } from '@/utils/log';
import { getAxiosInstance } from './http_api';
import { multipartUploadStore, PersistedMultipartUpload } from './multipart-upload-store';
import {
  CHUNK_SIZE,
  CreateUploadResponse,
  MAX_CONCURRENCY,
  MAX_RETRIES,
  UploadFileMultipartParams,
  UploadPartsResponse,
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

type UploadChunk = { partNumber: number; blob: Blob };

// Keyed by destination first, then by File reference. Two distinct File objects
// sharing metadata never collide; the same File uploaded to different
// workspace/view destinations also stays independent. A duplicate dispatch with
// the *same* File instance and *same* destination still dedupes.
const activeUploads = new Map<string, WeakMap<File, Promise<string>>>();

function getActiveUploadKey(workspaceId: string, viewId: string): string {
  return `${workspaceId}:${viewId}`;
}

function isStaleSessionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as {
    response?: { status?: number; data?: { code?: number; message?: string } };
    message?: string;
  };

  if (e.response?.status === 404) return true;
  const msg = e.message ?? e.response?.data?.message ?? '';

  return /upload.{0,8}(not\s*found|expired|invalid|missing|gone)/i.test(msg);
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
 * Lists parts that the server already has for this multipart upload.
 */
async function listUploadedParts(
  workspaceId: string,
  parentDir: string,
  fileId: string,
  uploadId: string
): Promise<UploadPartInfo[]> {
  const axiosInstance = getAxiosInstance();

  if (!axiosInstance) {
    throw new Error('API service not initialized');
  }

  const url = getMultipartUploadedPartsUrl(workspaceId, parentDir, fileId, uploadId);

  const response = await axiosInstance.get<APIResponse<UploadPartsResponse>>(url);

  if (response.data.code !== 0 || !response.data.data) {
    throw new Error(response.data.message || 'Failed to list uploaded parts');
  }

  return response.data.data.parts;
}

/**
 * Aborts an upload session so object storage can release incomplete parts.
 */
async function abortMultipartUpload(
  workspaceId: string,
  parentDir: string,
  fileId: string,
  uploadId: string
): Promise<void> {
  const axiosInstance = getAxiosInstance();

  if (!axiosInstance) {
    return;
  }

  const url = getMultipartAbortUrl(workspaceId, parentDir, fileId, uploadId);

  await axiosInstance.delete<APIResponse>(url);
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
    parts: [...parts]
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

function createChunks(file: File): UploadChunk[] {
  const chunks: UploadChunk[] = [];
  let offset = 0;
  let partNumber = 1;

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const blob = file.slice(offset, end);

    chunks.push({ partNumber, blob });
    offset = end;
    partNumber++;
  }

  return chunks;
}

function mergeParts(...partLists: UploadPartInfo[][]): UploadPartInfo[] {
  const partsByNumber = new Map<number, UploadPartInfo>();

  for (const parts of partLists) {
    for (const part of parts) {
      if (!part.e_tag || part.part_number < 1) {
        continue;
      }

      partsByNumber.set(part.part_number, part);
    }
  }

  return Array.from(partsByNumber.values()).sort((a, b) => a.part_number - b.part_number);
}

function getUploadedBytes(chunks: UploadChunk[], parts: UploadPartInfo[]): number {
  const uploadedPartNumbers = new Set(parts.map((part) => part.part_number));

  return chunks.reduce((total, chunk) => {
    return uploadedPartNumbers.has(chunk.partNumber) ? total + chunk.blob.size : total;
  }, 0);
}

async function getOrCreateSession(
  workspaceId: string,
  parentDir: string,
  file: File
): Promise<PersistedMultipartUpload> {
  const existingSession = await multipartUploadStore.getSession(workspaceId, parentDir, file);

  if (existingSession) {
    Log.debug('[UploadFile] multipart resumed session found', {
      fileId: existingSession.fileId,
      uploadId: existingSession.uploadId,
      partsCount: existingSession.parts.length,
    });

    return {
      ...existingSession,
      file,
    };
  }

  const requestedFileId = uuidv4();
  const { upload_id: uploadId, file_id: createdFileId } = await createMultipartUpload(
    workspaceId,
    parentDir,
    file,
    requestedFileId
  );
  const now = Date.now();
  const session: PersistedMultipartUpload = {
    id: multipartUploadStore.getSessionId(workspaceId, parentDir, file),
    workspaceId,
    viewId: parentDir,
    fileId: createdFileId || requestedFileId,
    uploadId,
    fileName: file.name,
    fileType: file.type || 'application/octet-stream',
    fileSize: file.size,
    fileLastModified: file.lastModified,
    chunkSize: CHUNK_SIZE,
    file,
    parts: [],
    createdAt: now,
    updatedAt: now,
  };

  await multipartUploadStore.saveSession(session);
  Log.debug('[UploadFile] multipart upload created', { uploadId, fileId: session.fileId });

  return session;
}

async function syncUploadedParts(session: PersistedMultipartUpload): Promise<UploadPartInfo[]> {
  try {
    const serverParts = await listUploadedParts(
      session.workspaceId,
      session.viewId,
      session.fileId,
      session.uploadId
    );
    const parts = mergeParts(session.parts, serverParts);

    if (parts.length !== session.parts.length) {
      await multipartUploadStore.saveSession({
        ...session,
        parts,
      });
    }

    return parts;
  } catch (error) {
    Log.warn('[UploadFile] multipart uploaded-parts lookup failed, using local session', error);
    return session.parts;
  }
}

async function uploadFileMultipartInternal({
  workspaceId,
  viewId,
  file,
  onProgress,
}: UploadFileMultipartParams): Promise<string> {
  Log.debug('[UploadFile] multipart starting', { fileName: file.name, fileSize: file.size });

  onProgress?.({
    phase: 'initializing',
    totalBytes: file.size,
    uploadedBytes: 0,
    percentage: 0,
  });

  const parentDir = viewId;
  const session = await getOrCreateSession(workspaceId, parentDir, file);

  try {
    const chunks = createChunks(file);

    Log.debug('[UploadFile] multipart chunks created', { totalChunks: chunks.length });

    const syncedParts = await syncUploadedParts(session);
    const partsByNumber = new Map<number, UploadPartInfo>(
      syncedParts.map((part) => [part.part_number, part])
    );
    let uploadedBytes = getUploadedBytes(chunks, syncedParts);
    const totalBytes = file.size;

    onProgress?.({
      phase: 'uploading',
      totalBytes,
      uploadedBytes,
      percentage: totalBytes === 0 ? 0 : Math.round((uploadedBytes / totalBytes) * 100),
    });

    const missingChunks = chunks.filter((chunk) => !partsByNumber.has(chunk.partNumber));

    await executeWithConcurrency(missingChunks, MAX_CONCURRENCY, async (chunk) => {
      const result = await uploadPart(
        workspaceId,
        parentDir,
        session.fileId,
        session.uploadId,
        chunk.partNumber,
        chunk.blob
      );

      partsByNumber.set(result.part_number, result);
      uploadedBytes += chunk.blob.size;

      await multipartUploadStore.saveSession({
        ...session,
        parts: Array.from(partsByNumber.values()),
      });

      onProgress?.({
        phase: 'uploading',
        totalBytes,
        uploadedBytes,
        percentage: Math.round((uploadedBytes / totalBytes) * 100),
      });

      return result;
    });

    const parts = Array.from(partsByNumber.values()).sort((a, b) => a.part_number - b.part_number);

    Log.debug('[UploadFile] multipart all parts uploaded', { partsCount: parts.length });

    onProgress?.({
      phase: 'completing',
      totalBytes,
      uploadedBytes: totalBytes,
      percentage: 100,
    });

    const fileUrl = await completeMultipartUpload(
      workspaceId,
      parentDir,
      session.uploadId,
      session.fileId,
      parts
    );

    await multipartUploadStore.deleteSession(session.id);

    Log.debug('[UploadFile] multipart completed', { fileUrl });

    return fileUrl;
  } catch (error) {
    // Discard a stale/expired server-side session so the next attempt starts
    // fresh instead of pinning the same (now-dead) uploadId forever.
    if (isStaleSessionError(error)) {
      Log.warn('[UploadFile] multipart session appears stale; discarding for next attempt', error);
      await multipartUploadStore.deleteSession(session.id).catch(() => undefined);
    }

    throw error;
  }
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
  const destKey = getActiveUploadKey(workspaceId, viewId);
  const destMap = activeUploads.get(destKey);
  const activeUpload = destMap?.get(file);

  if (activeUpload) {
    return activeUpload;
  }

  const upload = uploadFileMultipartInternal({ workspaceId, viewId, file, onProgress }).finally(
    () => {
      activeUploads.get(destKey)?.delete(file);
    }
  );
  const targetMap = destMap ?? new WeakMap<File, Promise<string>>();

  targetMap.set(file, upload);
  if (!destMap) {
    activeUploads.set(destKey, targetMap);
  }

  return upload;
}

export async function abortPersistedMultipartUpload(
  workspaceId: string,
  viewId: string,
  file: File
): Promise<void> {
  const session = await multipartUploadStore.getSession(workspaceId, viewId, file);

  if (!session) {
    return;
  }

  try {
    await abortMultipartUpload(workspaceId, viewId, session.fileId, session.uploadId);
  } finally {
    await multipartUploadStore.deleteSession(session.id);
  }
}
