import { buildFallbackLinkPreviewData, fetchLinkPreviewData, shouldFetchLinkPreview } from '../link-preview';
import { isSafeHttpUrl, requireHttpUrl, sanitizeHref } from '../url';

jest.mock('axios');

describe('isSafeHttpUrl', () => {
  it.each([
    'https://appflowy.io',
    'http://localhost:3000/app/1/2',
    'appflowy.io',
    '192.168.1.2',
    '  https://appflowy.io/docs  ',
  ])('accepts %s', (input) => {
    expect(isSafeHttpUrl(input)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://appflowy.io/uuid',
    '',
    '   ',
    'not a url',
  ])('rejects %s', (input) => {
    expect(isSafeHttpUrl(input)).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(42)).toBe(false);
  });
});

describe('requireHttpUrl', () => {
  it('normalizes bare domains to https', () => {
    expect(requireHttpUrl('appflowy.io')).toBe('https://appflowy.io');
  });

  it('never returns the raw attacker input', () => {
    expect(requireHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(requireHttpUrl('data:text/html,hi')).toBeUndefined();
    expect(requireHttpUrl('vbscript:x')).toBeUndefined();
  });
});

describe('sanitizeHref', () => {
  it.each([
    ['https://appflowy.io', 'https://appflowy.io'],
    ['appflowy.io', 'https://appflowy.io'],
    ['mailto:dev@appflowy.io', 'mailto:dev@appflowy.io'],
    ['tel:+123456789', 'tel:+123456789'],
    ['/app/workspace/view', '/app/workspace/view'],
    ['#anchor', '#anchor'],
  ])('allows %s', (input, expected) => {
    expect(sanitizeHref(input)).toBe(expected);
  });

  it.each([
    'javascript:alert(document.domain)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://appflowy.io/x',
    'mailto:',
    '/path with spaces',
    '',
  ])('blocks %s', (input) => {
    expect(sanitizeHref(input)).toBeUndefined();
  });
});

describe('link-preview unsafe schemes', () => {
  it('never fetches non-http(s) URLs', () => {
    expect(shouldFetchLinkPreview('javascript:alert(1)')).toBe(false);
    expect(shouldFetchLinkPreview('data:text/html,hi')).toBe(false);
    expect(shouldFetchLinkPreview('https://appflowy.io/docs')).toBe(true);
  });

  it('returns fallback data without network for unsafe URLs', async () => {
    const axios = (await import('axios')).default as unknown as { get: jest.Mock };

    axios.get.mockClear();

    const data = await fetchLinkPreviewData('javascript:alert(1)');

    expect(axios.get).not.toHaveBeenCalled();
    expect(data.title).toBe('javascript:alert(1)');
  });

  it('keeps fallback titles for unsafe input', () => {
    expect(buildFallbackLinkPreviewData('javascript:alert(1)').title).toBe('javascript:alert(1)');
    expect(buildFallbackLinkPreviewData('https://appflowy.io/docs').title).toContain('appflowy.io');
  });
});
