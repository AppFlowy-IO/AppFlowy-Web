import { getConfigValue } from '@/utils/runtime-config';

import { APIError, APIResponse, executeAPIRequest, getAxios, handleAPIError } from './core';

export interface ExportPdfOptions {
  includeNested?: boolean;
  includeDatabase?: boolean;
  includeImages?: boolean;
  maxDepth?: number;
}

export interface ExportPdfResult {
  blob: Blob;
  filename: string;
}

const DEFAULT_OPTIONS: Required<ExportPdfOptions> = {
  includeNested: true,
  includeDatabase: true,
  includeImages: true,
  maxDepth: 2,
};

interface CreateExportTaskRaw {
  task_id: string;
}

/**
 * Kick off a server-side backup of the whole workspace into a ZIP archive.
 *
 * This is asynchronous: the server builds the archive and emails the owner a
 * download link once it's ready. Only the workspace owner may call it. The
 * returned `taskId` identifies the export task.
 */
export async function exportWorkspace(workspaceId: string, includeFileAttachments = true): Promise<string> {
  const url = `/api/export/workspace/${encodeURIComponent(workspaceId)}`;

  const data = await executeAPIRequest<CreateExportTaskRaw>(() =>
    getAxios()?.post<APIResponse<CreateExportTaskRaw>>(
      url,
      { include_file_attachments: includeFileAttachments },
      {
        headers: {
          'X-Host': getConfigValue('APPFLOWY_BASE_URL', ''),
        },
      }
    )
  );

  return data.task_id;
}

export async function getViewPdfBlob(
  workspaceId: string,
  viewId: string,
  opts: ExportPdfOptions = {},
): Promise<ExportPdfResult> {
  const url = `/api/export/view/${workspaceId}/${viewId}/pdf`;
  const merged = { ...DEFAULT_OPTIONS, ...opts };

  try {
    const axiosInstance = getAxios();

    if (!axiosInstance) {
      const apiError: APIError = { code: -1, message: 'API service not initialized' };

      throw apiError;
    }

    const response = await axiosInstance.post<Blob>(url, undefined, {
      params: {
        include_nested: merged.includeNested,
        include_database: merged.includeDatabase,
        include_images: merged.includeImages,
        max_depth: merged.maxDepth,
      },
      responseType: 'blob',
      validateStatus: (status) => status < 400,
    });

    if (!response?.data) {
      const apiError: APIError = { code: -1, message: 'No response data received' };

      throw apiError;
    }

    const cd = response.headers?.['content-disposition'] as string | undefined;
    const fallback = `export-${viewId}.pdf`;
    const filename = parseFilenameFromContentDisposition(cd) ?? fallback;

    return { blob: response.data, filename };
  } catch (error) {
    throw handleAPIError(error);
  }
}

/**
 * Parse RFC 6266 Content-Disposition. Prefers `filename*=UTF-8''...` when present
 * (handles non-ASCII titles), falls back to plain `filename="..."`.
 */
export function parseFilenameFromContentDisposition(header?: string): string | null {
  if (!header) return null;

  const extMatch = /filename\*\s*=\s*([^;]+)/i.exec(header);

  if (extMatch) {
    const raw = extMatch[1].trim();
    const parts = raw.split("''");

    if (parts.length === 2) {
      try {
        return decodeURIComponent(parts[1].replace(/^"|"$/g, ''));
      } catch {
        // fall through
      }
    }
  }

  const plainMatch = /filename\s*=\s*"?([^";]+)"?/i.exec(header);

  if (plainMatch) {
    return plainMatch[1].trim();
  }

  return null;
}
