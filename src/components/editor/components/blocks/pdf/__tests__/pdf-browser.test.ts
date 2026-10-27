import { openPDFInBrowser, pdfBrowserSource } from '../pdf-browser';

describe('PDF browser preview', () => {
  const origin = 'https://app.example.com';

  it('opens an application preview tab with the complete source and filename', () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    const source = 'https://files.example.com/report.pdf?signature=a%2Bb&download=1';
    const filename = 'Research & findings.pdf';

    openPDFInBrowser(source, filename);
    const [target, name, features] = open.mock.calls[0];
    const url = new URL(target as string);

    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe('/app/pdf-preview');
    expect(url.searchParams.get('source')).toBe(source);
    expect(url.searchParams.get('name')).toBe(filename);
    expect(name).toBe('_blank');
    expect(features).toBe('noopener,noreferrer');
    open.mockRestore();
  });

  it.each([
    ['https://files.example.com/report.pdf', 'https://files.example.com/report.pdf'],
    ['/api/file_storage/report', `${origin}/api/file_storage/report`],
    [`blob:${origin}/file-id`, `blob:${origin}/file-id`],
  ])('accepts supported PDF source %s', (source, expected) => {
    expect(pdfBrowserSource(source, origin)).toBe(expected);
  });

  it.each(['', 'javascript:alert(1)', 'data:text/html,<script></script>', 'file:///report.pdf',
    'https://user:password@example.com/file.pdf', 'blob:https://another.example.com/file-id'])('rejects %s', (source) => {
    expect(pdfBrowserSource(source, origin)).toBeUndefined();
  });
});
