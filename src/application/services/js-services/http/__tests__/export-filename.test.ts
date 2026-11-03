import { parseFilenameFromContentDisposition, withUntitledFallback } from '../export-api';

describe('PDF export file names', () => {
  it('reads the bare extension the server sends for a page whose title was cleared', () => {
    expect(parseFilenameFromContentDisposition('attachment; filename=".pdf"')).toBe('.pdf');
  });

  it('names a nameless export after the untitled page name', () => {
    expect(withUntitledFallback('.pdf', 'Untitled')).toBe('Untitled.pdf');
    expect(withUntitledFallback('   .zip', 'Untitled')).toBe('Untitled.zip');
  });

  it('keeps named exports unchanged', () => {
    expect(withUntitledFallback('Quarterly report.pdf', 'Untitled')).toBe('Quarterly report.pdf');
    expect(withUntitledFallback('v1.2 notes.pdf', 'Untitled')).toBe('v1.2 notes.pdf');
    expect(withUntitledFallback('export-view.pdf', 'Untitled')).toBe('export-view.pdf');
  });
});
