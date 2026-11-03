export const PDF_BROWSER_PATH = '/app/pdf-preview';

export function pdfBrowserSource(value: string, origin: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value, origin);

    if (url.username || url.password) return;
    if (url.protocol === 'http:' || url.protocol === 'https:' || (url.protocol === 'blob:' && url.origin === origin))
      return url.href;
  } catch {
    // An invalid preview link must never become a navigation or fetch target.
  }
}

export function openPDFInBrowser(source: string, filename: string): void {
  const url = new URL(PDF_BROWSER_PATH, window.location.origin);

  url.searchParams.set('source', source);
  url.searchParams.set('name', filename);
  // A normal application tab can authenticate file requests and render PDFs
  // regardless of attachment headers, without navigating to uploaded content.
  window.open(url.href, '_blank', 'noopener,noreferrer');
}
