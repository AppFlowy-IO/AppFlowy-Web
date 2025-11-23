import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { sanitizeHTML, isHTMLSafe, extractTextFromHTML, sanitizeStyle } from '../sanitize';

// Mock isomorphic-dompurify
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: {
    sanitize: jest.fn((html: string, config?: unknown) => {
      // Simple mock that removes script tags and javascript: URLs
      let result = html;
      result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      result = result.replace(/javascript:/gi, '');
      result = result.replace(/on\w+="[^"]*"/gi, '');
      return result;
    }),
  },
}));

describe('sanitizeHTML', () => {
  it('should remove script tags', () => {
    const malicious = '<p>Hello<script>alert("XSS")</script>World</p>';
    const sanitized = sanitizeHTML(malicious);

    expect(sanitized).not.toContain('<script>');
    expect(sanitized).toContain('Hello');
    expect(sanitized).toContain('World');
  });

  it('should remove javascript: URLs from links', () => {
    const malicious = '<a href="javascript:alert(\'XSS\')">Click me</a>';
    const sanitized = sanitizeHTML(malicious);

    expect(sanitized).not.toContain('javascript:');
    expect(sanitized).toContain('Click me');
  });

  it('should remove onclick and other event handlers', () => {
    const malicious = '<p onclick="alert(\'XSS\')">Click me</p>';
    const sanitized = sanitizeHTML(malicious);

    expect(sanitized).not.toContain('onclick');
    expect(sanitized).toContain('Click me');
  });

  it('should preserve safe HTML formatting', () => {
    const safe = '<p>This is <strong>bold</strong> and <em>italic</em></p>';
    const sanitized = sanitizeHTML(safe);

    expect(sanitized).toContain('<strong>bold</strong>');
    expect(sanitized).toContain('<em>italic</em>');
  });

  it('should preserve links with http/https', () => {
    const safe = '<a href="https://example.com">Link</a>';
    const sanitized = sanitizeHTML(safe);

    expect(sanitized).toContain('href="https://example.com"');
    expect(sanitized).toContain('Link');
  });

  it('should handle empty input', () => {
    expect(sanitizeHTML('')).toBe('');
    expect(sanitizeHTML('   ')).toBe('');
  });
});

describe('sanitizeStyle', () => {
  it('should extract allowed CSS properties', () => {
    const style = 'color: red; background-color: blue; text-align: center;';
    const sanitized = sanitizeStyle(style);

    expect(sanitized).toEqual({
      'color': 'red',
      'background-color': 'blue',
      'text-align': 'center',
    });
  });

  it('should ignore disallowed properties', () => {
    const style = 'color: red; position: absolute; display: none;';
    const sanitized = sanitizeStyle(style);

    expect(sanitized).toEqual({
      'color': 'red',
    });
    expect(sanitized).not.toHaveProperty('position');
    expect(sanitized).not.toHaveProperty('display');
  });

  it('should remove javascript expressions', () => {
    const malicious = 'color: expression(alert("XSS")); background: url(javascript:alert("XSS"));';
    const sanitized = sanitizeStyle(malicious);

    expect(Object.keys(sanitized)).toHaveLength(0);
  });

  it('should handle empty style', () => {
    expect(sanitizeStyle('')).toEqual({});
    expect(sanitizeStyle('   ')).toEqual({});
  });

  it('should preserve font styling', () => {
    const style = 'font-weight: bold; font-style: italic; text-decoration: underline;';
    const sanitized = sanitizeStyle(style);

    expect(sanitized).toEqual({
      'font-weight': 'bold',
      'font-style': 'italic',
      'text-decoration': 'underline',
    });
  });

  it('should handle malformed style strings', () => {
    const malformed = 'color:red;invalid;background-color:blue';
    const sanitized = sanitizeStyle(malformed);

    expect(sanitized['color']).toBe('red');
    expect(sanitized['background-color']).toBe('blue');
  });
});

describe('isHTMLSafe', () => {
  it('should return true for safe HTML', () => {
    const safe = '<p>Hello <strong>World</strong></p>';
    expect(isHTMLSafe(safe)).toBe(true);
  });

  it('should return true for empty input', () => {
    expect(isHTMLSafe('')).toBe(true);
  });
});

describe('extractTextFromHTML', () => {
  it('should extract plain text from HTML', () => {
    const html = '<p>Hello <strong>World</strong></p>';
    const text = extractTextFromHTML(html);

    expect(text).toContain('Hello');
    expect(text).toContain('World');
  });

  it('should handle empty HTML', () => {
    expect(extractTextFromHTML('')).toBe('');
  });
});
