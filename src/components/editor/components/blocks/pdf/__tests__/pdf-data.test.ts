import { isLocalPDF, isNetworkPDF, parsePDFLink, pdfFileName, pdfProxyUrl, pdfSize } from '../pdf-data';

describe('Flutter PDF data compatibility', () => {
  it.each(['https://example.com/REPORT.PDF?download=1', ' https://example.com/report.pdf#page=2 '])(
    'recognizes a PDF path independently of query and fragment: %s',
    (url) => {
      expect(parsePDFLink(url)?.isPDF).toBe(true);
    }
  );
  it.each([
    'not a url',
    'javascript:alert(1)',
    'data:application/pdf,hello',
    'file:///private/report.pdf',
    'https://user:password@example.com/report.pdf',
  ])('rejects invalid or unsafe embed URLs: %s', (url) => {
    expect(parsePDFLink(url)).toBeNull();
  });
  it('classifies non-PDF links for Flutter link-preview fallback', () => {
    expect(parsePDFLink('https://example.com/page')?.isPDF).toBe(false);
  });
  it('only proxies public cross-origin sources, never local or authenticated files', () => {
    expect(pdfProxyUrl('https://example.com/book.pdf')).toBe('/api/pdf-proxy?url=https%3A%2F%2Fexample.com%2Fbook.pdf');
    for (const source of [new URL('/book.pdf', window.location.origin).href, 'blob:https://example.com/id',
      'data:application/pdf,hello', 'https://user:password@example.com/book.pdf', '/api/file_storage/file',
      'https://test.appflowy.cloud/api/file_storage/workspace/file.pdf']) {
      expect(pdfProxyUrl(source)).toBeUndefined();
    }
  });
  it('normalizes a pasted domain before converting a non-PDF link to a bookmark', () => {
    expect(parsePDFLink('www.gemini.google.com')).toMatchObject({ url: 'https://www.gemini.google.com/', isPDF: false });
    expect(parsePDFLink('example.com/report.pdf')).toMatchObject({ url: 'https://example.com/report.pdf', isPDF: true });
  });
  it('preserves names and decodes a network filename without including signed query parameters', () => {
    expect(pdfFileName({ name: 'Report', url: 'https://example.com/other.pdf' })).toBe('Report');
    expect(pdfFileName({ url: 'https://example.com/My%20Report.pdf?secret=opaque#page=2' })).toBe('My Report.pdf');
  });
  it.each([
    '/Users/user/report.pdf',
    'file:///home/report.pdf',
    'C:\\Users\\report.pdf',
    '\\\\server\\share\\report.pdf',
  ])('detects device-local PDFs instead of fetching them from the web origin: %s', (url) => {
    expect(isLocalPDF({ url })).toBe(true);
  });
  it('accepts Flutter and legacy web URL types', () => {
    expect(isNetworkPDF({ url_type: 'network' })).toBe(true);
    expect(isNetworkPDF({ url_type: 1 })).toBe(true);
    expect(isNetworkPDF({ url_type: 'cloud' })).toBe(false);
    expect(isLocalPDF({ url_type: 'local', url: 'id' })).toBe(true);
  });
  it('clamps corrupt/older layout values and keeps Flutter resize factors', () => {
    expect(pdfSize({})).toEqual({ widthFactor: 1, heightFactor: 1 });
    expect(pdfSize({ widthFactor: NaN, heightFactor: Infinity })).toEqual({ widthFactor: 1, heightFactor: 1 });
    expect(pdfSize({ widthFactor: 10, heightFactor: -1 })).toEqual({ widthFactor: 1, heightFactor: 0.3 });
    expect(pdfSize({ widthFactor: 0.25, heightFactor: 0.5 })).toEqual({ widthFactor: 0.25, heightFactor: 0.5 });
  });
});
