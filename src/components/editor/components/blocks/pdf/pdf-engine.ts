import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { getTokenParsed } from '@/application/session/token';
import { isAppFlowyAuthenticatedFileUrl } from '@/utils/file-storage-url';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Only first-party storage receives session credentials; external PDFs never do. */
export function openPDF(url: string, password?: string) {
  const token = isAppFlowyAuthenticatedFileUrl(url) ? getTokenParsed() : null;
  const assetBase = `${import.meta.env.BASE_URL}pdfjs/`;

  return getDocument({
    url,
    password,
    httpHeaders: token ? { Authorization: `Bearer ${token.access_token}`, 'x-platform': 'web-app' } : undefined,
    cMapUrl: `${assetBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    wasmUrl: `${assetBase}wasm/`,
    isEvalSupported: false,
  });
}

export { TextLayer } from 'pdfjs-dist';
