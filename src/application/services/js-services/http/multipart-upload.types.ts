/**
 * Type definitions for multipart file upload
 */

/**
 * Progress information during multipart upload
 */
export interface MultipartUploadProgress {
  phase: 'initializing' | 'uploading' | 'completing';
  totalBytes: number;
  uploadedBytes: number;
  percentage: number;
}

/**
 * Information about an uploaded part
 */
export interface UploadPartInfo {
  part_number: number;
  e_tag: string;
}

/**
 * Parameters for the main upload function
 */
export interface UploadFileMultipartParams {
  workspaceId: string;
  viewId: string;
  file: File;
  onProgress?: (progress: MultipartUploadProgress) => void;
}

/**
 * Response from create upload endpoint
 */
export interface CreateUploadResponse {
  upload_id: string;
  file_id: string;
}

/**
 * Response from complete upload endpoint
 */
export interface CompleteUploadResponse {
  url: string;
}

// Constants for multipart upload configuration
export const MULTIPART_THRESHOLD = 5 * 1024 * 1024; // 5MB - files >= this size use multipart
export const CHUNK_SIZE = 5 * 1024 * 1024;          // 5MB - AWS S3 minimum part size
export const MAX_CONCURRENCY = 3;                   // Max parallel part uploads
export const MAX_RETRIES = 3;                       // Per-part retry attempts
