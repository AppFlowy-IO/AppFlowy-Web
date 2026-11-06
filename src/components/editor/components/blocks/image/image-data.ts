import { ImageBlockData, ImageType } from '@/application/types';
import { ERROR_CODE } from '@/application/constants';
import { readErrorIdentity } from '@/application/errors/error-message';

export function imageUploadLimitCode(error: unknown): number | null {
  const { code, sourceDomain } = readErrorIdentity(error);

  return sourceDomain === 'appflowy.server' && isImageUploadLimit(code) ? code! : null;
}

export function isImageUploadLimit(code?: number | null) {
  return code === ERROR_CODE.SINGLE_UPLOAD_LIMIT_EXCEEDED || code === ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED;
}

export function isSupportedImage(data: ImageBlockData) {
  return (
    data.image_type === undefined || [ImageType.Local, ImageType.Internal, ImageType.External].includes(data.image_type)
  );
}

export function imageURL(value: string) {
  try {
    const url = new URL(value.trim());

    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function imageName(data: ImageBlockData) {
  if (data.name) return data.name;
  try {
    return decodeURIComponent(new URL(data.url || '').pathname.split('/').pop() || 'Image');
  } catch {
    return 'Image';
  }
}

export function imageLink(value?: string): { is_page_link: boolean; page_id?: string; url: string } | undefined {
  try {
    if (!value) return;
    const link = JSON.parse(value);

    if (link.is_page_link === true && typeof link.page_id === 'string' && link.page_id)
      return { ...link, url: typeof link.url === 'string' ? imageURL(link.url) || link.page_id : link.page_id };
    const url = typeof link.url === 'string' ? imageURL(link.url) : undefined;

    if (url) return { is_page_link: false, url };
  } catch {
    /* Preserve invalid legacy values without following them. */
  }
}
