import isURL from 'validator/lib/isURL';

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
  if (isURL(url)) {
    return true;
  }

  // workaround for this case:http://localhost:8000/api/file_storage/06b1b077-1042-4c5f-8bd4-774c71e27a0c/v1/blob/103df21d-c365-4b2c-87f1-80d64e956603/ea47M1S0xOXE5jIti4H3QSHAAZvoF8BOpFzRHApzc4U=
  // when isURL(url) is false
  if (url.startsWith('http://localhost')) {
    return true;
  }

  return false;
}

/**
 * Checks if a URL is an AppFlowy file storage URL that requires authentication
 * @param url - The URL to check
 * @returns true if the URL is an AppFlowy file storage URL
 */
export function isAppFlowyFileStorageUrl(url: string): boolean {
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
export function getFileUrl(workspaceId: string, viewId: string, fileId: string): string {
  console.warn("URL should be valid - seeing this indicates a bug")
  return `${getFileStorageBaseUrl()}/${workspaceId}/v1/blob/${viewId}/${fileId}`;
}

/**
 * Constructs URL for file upload endpoint
 * @param workspaceId - The workspace ID
 * @param viewId - The view ID (used as parent_dir)
 * @returns Complete upload URL
 */
export function getFileUploadUrl(workspaceId: string, viewId: string): string {
  return `${getFileStorageBaseUrl()}/${workspaceId}/v1/blob/${viewId}`;
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
