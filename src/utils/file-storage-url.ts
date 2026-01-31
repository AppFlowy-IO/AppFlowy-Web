import isURL from 'validator/lib/isURL';

import { Log } from '@/utils/log';
import { getConfigValue } from '@/utils/runtime-config';

/**
 * Constructs file storage URLs for the AppFlowy API
 * Centralizes URL construction logic to reduce code duplication
 */

/**
 * Gets the base URL for file storage API
 */
function getFileStorageBaseUrl(): string {
  return getConfigValue('APPFLOWY_BASE_URL', '') + '/api/file_storage';
}

function resolveAppflowyOriginAndPathname(): { origin: string | null; pathname: string | null } {
  const baseUrl = getConfigValue('APPFLOWY_BASE_URL', '').trim();

  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);

      return {
        origin: parsed.origin,
        pathname: `${parsed.pathname.replace(/\/$/, '')}/api/file_storage`,
      };
    } catch (error) {
      console.warn('Invalid APPFLOWY_BASE_URL provided:', error);
    }
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return { origin: window.location.origin, pathname: '/api/file_storage' };
  }

  return { origin: null, pathname: null };
}


export function isFileURL(url: string): boolean {
  if (isAppFlowyFileStorageUrl(url)) {
    return true;
  }

  // validator/lib/isURL may fail for localhost if strict options are used,
  // or simply return false for some valid internal URLs.
  // We specifically allow localhost URLs.
  if (url.startsWith('http://localhost') || url.startsWith('https://localhost')) {
    return true;
  }

  return isURL(url);
}

/**
 * Checks if a URL is an AppFlowy file storage URL that requires authentication
 * @param url - The URL to check
 * @returns true if the URL is an AppFlowy file storage URL
 */
export function isAppFlowyFileStorageUrl(url: string): boolean {
  Log.debug('[isAppFlowyFileStorageUrl] url', url);

  if (!url) return false;

  const { origin, pathname: basePathname } = resolveAppflowyOriginAndPathname();

  if (!origin || !basePathname) {
    return false;
  }

  let parsedUrl: URL;

  try {
    parsedUrl =
      url.startsWith('http://') || url.startsWith('https://') ? new URL(url) : new URL(url, origin);
  } catch (error) {
    console.warn('Failed to parse file storage URL:', error);
    return false;
  }

  const isFirstParty = parsedUrl.origin === origin;
  const normalizedBasePath = basePathname.startsWith('/') ? basePathname : `/${basePathname}`;
  const isFileStoragePath = parsedUrl.pathname.startsWith(normalizedBasePath);

  return isFirstParty && isFileStoragePath;
}

/**
 * Constructs URL for file retrieval
 * @param workspaceId - The workspace ID
 * @param viewId - The view ID (parent directory)
 * @param fileId - The file ID
 * @returns Complete file URL
 */
export function getAppFlowyFileUrl(workspaceId: string, viewId: string, fileId: string): string {
  console.warn("URL should be valid - seeing this indicates a bug")
  return `${getFileStorageBaseUrl()}/${workspaceId}/v1/blob/${viewId}/${fileId}`;
}

/**
 * Constructs URL for file upload endpoint
 * @param workspaceId - The workspace ID
 * @param viewId - The view ID (used as parent_dir)
 * @returns Complete upload URL
 */
export function getAppFlowyFileUploadUrl(workspaceId: string, viewId: string): string {
  return `${getFileStorageBaseUrl()}/${workspaceId}/v1/blob/${viewId}`;
}

/**
 * Constructs URL for creating a multipart upload session
 * @param workspaceId - The workspace ID
 * @returns Complete create upload URL
 */
export function getMultipartCreateUrl(workspaceId: string): string {
  return `${getFileStorageBaseUrl()}/${workspaceId}/create_upload`;
}

/**
 * Constructs URL for uploading a part in a multipart upload
 * @param workspaceId - The workspace ID
 * @param parentDir - The parent directory (view ID)
 * @param fileId - The file ID
 * @param uploadId - The upload session ID
 * @param partNumber - The part number (1-indexed)
 * @returns Complete upload part URL
 */
export function getMultipartUploadPartUrl(
  workspaceId: string,
  parentDir: string,
  fileId: string,
  uploadId: string,
  partNumber: number
): string {
  return `${getFileStorageBaseUrl()}/${workspaceId}/upload_part/${parentDir}/${fileId}/${uploadId}/${partNumber}`;
}

/**
 * Constructs URL for completing a multipart upload
 * @param workspaceId - The workspace ID
 * @returns Complete upload completion URL
 */
export function getMultipartCompleteUrl(workspaceId: string): string {
  return `${getFileStorageBaseUrl()}/${workspaceId}/complete_upload`;
}

/**
 * General purpose file storage URL constructor
 * @param workspaceId - The workspace ID
 * @param viewId - Optional view ID
 * @param fileId - Optional file ID
 * @returns Complete file storage URL
 */
export function constructFileStorageUrl(
  workspaceId: string,
  viewId?: string,
  fileId?: string
): string {
  const base = `${getFileStorageBaseUrl()}/${workspaceId}/v1/blob`;

  if (viewId && fileId) {
    return `${base}/${viewId}/${fileId}`;
  }

  if (viewId) {
    return `${base}/${viewId}`;
  }

  if (fileId) {
    return `${base}/${fileId}`;
  }

  return base;
}

/**
 * Resolves a file URL or ID into a complete accessible URL.
 * If the input is already a URL (http/https), it returns it as is.
 * If it's a file ID, it constructs the AppFlowy file storage URL.
 * 
 * @param urlOrId - The file URL or ID
 * @param workspaceId - The workspace ID
 * @param viewId - The view ID
 * @returns The resolved complete URL
 */
export function resolveFileUrl(
  urlOrId: string | undefined,
  workspaceId: string,
  viewId: string
): string {
  if (!urlOrId) return '';

  if (isFileURL(urlOrId)) {
    return urlOrId;
  }

  return getAppFlowyFileUrl(workspaceId, viewId, urlOrId);
}
