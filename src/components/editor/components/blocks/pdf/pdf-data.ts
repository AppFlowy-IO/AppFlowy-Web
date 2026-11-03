
import { PDFBlockData } from '@/application/types';
import { isLocalFilePath, isAppFlowyAuthenticatedFileUrl } from '@/utils/file-storage-url';
import { processUrl } from '@/utils/url';

export const PDF_DEFAULT_HEIGHT = 400;
export const PDF_MIN_SIZE = 120;

export function pdfFileName(data: PDFBlockData): string {
  if (data.name?.trim()) return data.name;
  try {
    return decodeURIComponent(new URL(data.url || '').pathname.split('/').pop() || '') || 'document.pdf';
  } catch {
    return 'document.pdf';
  }
}

export function isLocalPDF(data: PDFBlockData): boolean {
  return data.url_type === 'local' || isLocalFilePath(data.url);
}

export function isNetworkPDF(data: PDFBlockData): boolean {
  if (data.url && isAppFlowyAuthenticatedFileUrl(data.url)) return false;
  return data.url_type === 'network' || data.url_type === 1 || data.url_type === 0 || data.url_type === undefined;
}

export function pdfSize(data: PDFBlockData) {
  const finite = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  return {
    widthFactor: Math.min(1, Math.max(0.05, finite(data.widthFactor, 1))),
    heightFactor: Math.min(4, Math.max(0.3, finite(data.heightFactor, 1))),
  };
}

export function parsePDFLink(value: string): { url: string; isPDF: boolean; name: string } | null {
  try {
    const normalized = processUrl(value.trim());

    if (!normalized) return null;
    const url = new URL(normalized);

    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return { url: url.href, isPDF: url.pathname.toLowerCase().endsWith('.pdf'), name: pdfFileName({ url: url.href }) };
  } catch {
    return null;
  }
}

/** Public cross-origin files can fall back to our server when their host omits CORS. */
export function pdfProxyUrl(source: string): string | undefined {
  try {
    const url = new URL(source);

    if (
      !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.origin === window.location.origin || isAppFlowyAuthenticatedFileUrl(source)
    ) return undefined;
    return `/api/pdf-proxy?url=${encodeURIComponent(url.href)}`;
  } catch {
    return undefined;
  }
}
