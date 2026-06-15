import { resolveFileUrl } from '@/utils/file-storage-url';

/**
 * Constructs the appropriate URL for file/image blocks
 *
 * Handles three cases:
 * 1. Full URLs (http/https) - returned as-is
 * 2. Relative API paths (/api/file_storage/...) - prepends base URL
 * 3. Legacy file IDs - constructs full path with workspace and view IDs
 *
 * @param dataUrl - The URL/path/ID from the block data
 * @param workspaceId - Current workspace ID
 * @param viewId - Current view ID (parent_dir for file storage)
 * @returns Complete URL for accessing the file
 */
export function constructFileUrl(
  dataUrl: string | undefined,
  workspaceId: string,
  viewId?: string
): string {
  if (!dataUrl) {
    console.warn('File URL construction: dataUrl is undefined');
    return '';
  }

  return resolveFileUrl(dataUrl, workspaceId, viewId || '');
}