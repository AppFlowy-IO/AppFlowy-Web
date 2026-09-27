import { queryIntegration } from '@/application/services/domains/integration';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  thumbnailLink?: string;
  trashed?: boolean;
}

export interface DriveFiles {
  files?: DriveFile[];
  nextPageToken?: string;
}

const FILE_FIELDS = 'id,name,mimeType,webViewLink,thumbnailLink,trashed';

export function listDriveFiles(
  workspaceId: string,
  connectionId: string,
  search: string,
  pageToken?: string,
  signal?: AbortSignal
) {
  // Drive queries use single-quoted literals; both escapes must be preserved.
  const term = search.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  return queryIntegration<DriveFiles>(
    workspaceId,
    connectionId,
    '/drive/v3/files',
    {
      q: `trashed = false${term ? ` and name contains '${term}'` : ''}`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: '50',
      orderBy: 'modifiedTime desc',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      ...(pageToken ? { pageToken } : {}),
    },
    signal
  );
}

export function getDriveFile(workspaceId: string, connectionId: string, fileId: string, signal?: AbortSignal) {
  return queryIntegration<DriveFile>(
    workspaceId,
    connectionId,
    `/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      fields: FILE_FIELDS,
      supportsAllDrives: 'true',
    },
    signal
  );
}

export function driveFileUrl(file: DriveFile): string {
  // Construct trusted URLs rather than persisting arbitrary provider response URLs.
  const id = encodeURIComponent(file.id);
  const types: Record<string, string> = {
    'application/vnd.google-apps.document': 'document',
    'application/vnd.google-apps.spreadsheet': 'spreadsheets',
    'application/vnd.google-apps.presentation': 'presentation',
    'application/vnd.google-apps.form': 'forms',
  };
  const type = types[file.mimeType];

  if (type) return `https://docs.google.com/${type}/d/${id}/edit`;
  if (file.mimeType === 'application/vnd.google-apps.folder') return `https://drive.google.com/drive/folders/${id}`;
  return `https://drive.google.com/file/d/${id}/view`;
}
