import DOMPurify from 'isomorphic-dompurify';

/**
 * Configuration for HTML sanitization
 */
const SANITIZE_CONFIG: DOMPurify.Config & { [key: string]: unknown } = {
  // Allowed HTML tags for AppFlowy blocks
  ALLOWED_TAGS: [
    // Text blocks
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'code',
    // Lists
    'ul', 'ol', 'li',
    // Inline formatting
    'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del',
    'a', 'span', 'div',
    // Tables
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    // Media
    'img',
    // Structure
    'br', 'hr',
    // Todo lists
    'input',
  ],

  // Allowed attributes
  ALLOWED_ATTR: [
    // Links
    'href', 'target', 'rel',
    // Images
    'src', 'alt', 'width', 'height',
    // Styling (for colors and alignment)
    'style', 'class',
    // Table attributes
    'colspan', 'rowspan',
    // Todo checkboxes
    'type', 'checked',
    // Data attributes for specific use cases
    'data-*',
  ],

  // Allowed URI schemes (prevent javascript: URLs)
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,

  // Don't allow data URIs in script contexts
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,

  // Return a DOM element instead of HTML string
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  RETURN_DOM_IMPORT: false,

  // Sanitize style attributes
  SANITIZE_NAMED_PROPS: true,

  // Keep whitespace
  KEEP_CONTENT: true,
};

/**
 * Sanitizes HTML content to prevent XSS attacks while preserving formatting
 * @param html Raw HTML string from clipboard
 * @returns Sanitized HTML safe for parsing
 *
 * @example
 * ```typescript
 * const userHTML = '<p>Hello <script>alert("XSS")</script>World</p>';
 * const safe = sanitizeHTML(userHTML);
 * // Returns: '<p>Hello World</p>'
 * ```
 */
export function sanitizeHTML(html: string): string {
  if (!html || html.trim().length === 0) {
    return '';
  }

  try {
    const sanitized = DOMPurify.sanitize(html, SANITIZE_CONFIG);

    return sanitized;
  } catch (error) {
    console.error('Error sanitizing HTML:', error);
    return '';
  }
}

/**
 * Checks if HTML contains potentially malicious content
 * @param html HTML string to check
 * @returns True if content is safe, false if sanitization changed the content significantly
 */
export function isHTMLSafe(html: string): boolean {
  if (!html) return true;

  const sanitized = sanitizeHTML(html);

  // If sanitization removed more than 20% of the content,
  // it might have contained malicious code
  const originalLength = html.replace(/\s/g, '').length;
  const sanitizedLength = sanitized.replace(/\s/g, '').length;

  if (originalLength === 0) return true;

  const diff = (originalLength - sanitizedLength) / originalLength;

  return diff < 0.2; // Less than 20% removed
}

/**
 * Extracts safe text content from HTML without any tags
 * Useful as a fallback when HTML parsing fails
 * @param html HTML string
 * @returns Plain text content
 */
export function extractTextFromHTML(html: string): string {
  const sanitized = sanitizeHTML(html);
  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitized, 'text/html');

  return doc.body.textContent || '';
}

/**
 * Sanitizes style attribute to only keep safe CSS properties
 * @param style Style string from HTML element
 * @returns Sanitized style object with allowed properties
 */
export function sanitizeStyle(style: string): Record<string, string> {
  const allowed = [
    'color',
    'background-color',
    'text-align',
    'font-weight',
    'font-style',
    'text-decoration',
  ];

  const result: Record<string, string> = {};

  if (!style) return result;

  // Parse style string
  const pairs = style.split(';').filter(Boolean);

  for (const pair of pairs) {
    const [key, value] = pair.split(':').map((s) => s.trim());

    if (key && value && allowed.includes(key.toLowerCase())) {
      // Basic validation of CSS values (prevent expressions)
      if (!/javascript|expression|@import|url\(/i.test(value)) {
        result[key.toLowerCase()] = value;
      }
    }
  }

  return result;
}
