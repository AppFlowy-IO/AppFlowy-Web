import { DriveFile, driveFileUrl } from '@/application/integrations/google-drive';
import { GoogleDriveBlockData } from '@/application/types';
import { processUrl } from '@/utils/url';

import { getGoogleDriveFileId, isGoogleDriveUrl, resolveGoogleDriveName } from './google-drive-utils';

export function driveLink(value: string): string | undefined {
  try {
    const url = new URL(processUrl(value.trim()) || value.trim());

    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.'))
      return;
    return url.href;
  } catch {
    return;
  }
}

export function driveName(data: GoogleDriveBlockData) {
  return data.name?.trim() || (data.url && resolveGoogleDriveName(data.url)) || 'Google Drive Embed';
}

export function driveFileData(file: DriveFile, email?: string): Partial<GoogleDriveBlockData> {
  return {
    url: driveFileUrl(file),
    name: file.name,
    file_id: file.id,
    email: email || '',
    mime_type: file.mimeType,
    size: file.size || '',
    modified_time: file.modifiedTime || '',
    uploaded_at: Date.now(),
  };
}

export function driveLinkData(url: string): Partial<GoogleDriveBlockData> {
  return {
    url,
    name: resolveGoogleDriveName(url),
    email: '',
    file_id: '',
    mime_type: '',
    size: '',
    modified_time: '',
    uploaded_at: Date.now(),
  };
}

export function driveType(data: GoogleDriveBlockData) {
  const type = data.mime_type?.split('.').pop();

  if (type === 'document' || type === 'spreadsheet' || type === 'presentation' || type === 'form' || type === 'folder')
    return type;
  const path = data.url ? new URL(driveLink(data.url) || 'https://drive.google.com').pathname : '';

  if (path.includes('/document/')) return 'document';
  if (path.includes('/spreadsheets/')) return 'spreadsheet';
  if (path.includes('/presentation/')) return 'presentation';
  if (path.includes('/forms/')) return 'form';
  if (path.includes('/folders/')) return 'folder';
  return 'file';
}

export function driveSize(data: GoogleDriveBlockData) {
  const finite = (value: number | undefined, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

  return { width_factor: finite(data.width_factor, 1, 0.1, 1), height_factor: finite(data.height_factor, 1, 0.3, 3) };
}

export function validDriveSource(value: string | undefined) {
  const url = value && driveLink(value);

  return url && isGoogleDriveUrl(url) && getGoogleDriveFileId(url) ? url : '';
}

/** Footer metadata is optional: public links must not trigger third-party lookups. */
export function driveDetails(data: GoogleDriveBlockData, locale: string, type: string, now = Date.now()) {
  const details: string[] = [];
  const bytes = Number(data.size);

  if (data.size && Number.isFinite(bytes) && bytes >= 0) {
    const unit = bytes ? Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;

    details.push(
      `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bytes / 1024 ** unit)} ${
        ['B', 'KB', 'MB', 'GB'][unit]
      }`
    );
  }

  const modified = Date.parse(data.modified_time || '');

  if (Number.isFinite(modified)) {
    const seconds = (modified - now) / 1000;
    const unit = Math.abs(seconds) >= 86400 ? 'day' : Math.abs(seconds) >= 3600 ? 'hour' : 'minute';
    const divisor = unit === 'day' ? 86400 : unit === 'hour' ? 3600 : 60;

    details.push(new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / divisor), unit));
  }

  if (!details.length) return '';
  details.push(type);
  const url = driveLink(data.url || '');

  if (url) details.push(new URL(url).origin);
  return details.join(' • ');
}
