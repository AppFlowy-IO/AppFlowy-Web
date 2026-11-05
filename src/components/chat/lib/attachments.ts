/**
 * Chat attachments travel inside the question text as `[IMAGE:url]` and
 * `[FILE:url]` markers. The AI service strips them before prompting the model
 * and reads the files; the stored question keeps them, so the client parses
 * them back out for display.
 */

export const MAX_IMAGE_ATTACHMENTS = 4;
export const MAX_FILE_ATTACHMENTS = 4;

const IMAGE_MARKER = /\[IMAGE:([^\]\s]+)\]/g;
const FILE_MARKER = /\[FILE:([^\]\s]+)\]/g;

export type AttachmentKind = 'image' | 'file';

export interface ParsedAttachments {
  /** Question text with every marker removed. */
  text: string;
  images: string[];
  files: string[];
}

export function parseAttachmentMarkers(content: string): ParsedAttachments {
  const images: string[] = [];
  const files: string[] = [];

  const withoutImages = content.replace(IMAGE_MARKER, (_match, url: string) => {
    images.push(url);
    return '';
  });
  const text = withoutImages.replace(FILE_MARKER, (_match, url: string) => {
    files.push(url);
    return '';
  });

  return {
    text: text.replace(/[ \t]+\n/g, '\n').trim(),
    images,
    files,
  };
}

export function formatQuestionWithAttachments(
  text: string,
  attachments: { kind: AttachmentKind; url: string }[]
): string {
  const markers = attachments
    .map(({ kind, url }) => (kind === 'image' ? `[IMAGE:${url}]` : `[FILE:${url}]`))
    .join(' ');

  if (!markers) return text;

  return text.trim() ? `${markers}\n${text}` : markers;
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|heic|heif)$/i;

export function attachmentKindForFile(file: { type: string; name: string }): AttachmentKind {
  if (file.type.startsWith('image/') || IMAGE_EXTENSIONS.test(file.name)) return 'image';

  return 'file';
}

export function fileNameFromAttachmentUrl(url: string): string {
  try {
    const name = new URL(url, 'http://localhost').pathname.split('/').pop() || '';

    return decodeURIComponent(name) || url;
  } catch {
    return url;
  }
}
