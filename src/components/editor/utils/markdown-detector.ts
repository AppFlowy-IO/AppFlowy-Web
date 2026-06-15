/**
 * Detects if plain text contains Markdown formatting
 * Uses heuristics to identify common Markdown patterns
 * @param text Plain text string
 * @returns True if text likely contains Markdown
 */
export function detectMarkdown(text: string): boolean {
  if (!text || text.trim().length === 0) return false;

  // Patterns that indicate Markdown formatting
  const patterns = [
    /^#{1,6}\s+/m, // Headings: # Heading
    /\*\*[^*]+\*\*/, // Bold: **text**
    /__[^_]+__/, // Bold alternative: __text__
    /\*[^*]+\*/,        // Italic: *text*
    /_[^_]+_/,          // Italic alternative: _text_
    /~~[^~]+~~/,        // Strikethrough: ~~text~~
    /^\s*[-*+•◦▪⁃–—]\s+/m,    // Unordered list: - item or * item or • item (and other bullets)
    /^\s*\d+\.\s+/m,    // Ordered list: 1. item
    /^\s*>\s+/m,        // Blockquote: > quote
    /^\s*```/m,         // Code block: ```
    /`[^`]+`/,          // Inline code: `code`
    /\[([^\]]+)\]\(([^)]+)\)/, // Link: [text](url)
    /!\[([^\]]*)\]\(([^)]+)\)/, // Image: ![alt](url)
    /^\s*[-*_]{3,}\s*$/m,      // Horizontal rule: ---, ***, ___
    /^\s*\|.*\|.*\|/m,         // Table: | cell | cell |
    /^\s*-\s*\[[ xX]\]/m,      // Task list: - [ ] task or - [x] task
  ];

  // Count how many patterns match
  let matchCount = 0;

  for (const pattern of patterns) {
    if (pattern.test(text)) {
      matchCount++;
    }
  }

  // If any pattern matches, likely Markdown
  // We used to require 2 matches, but that failed for simple cases like "**bold**"
  return matchCount >= 1;
}

/**
 * Estimates the "Markdown density" of text (0-1 scale)
 * Higher values indicate more Markdown formatting
 * @param text Plain text string
 * @returns Markdown density score (0-1)
 */
export function getMarkdownDensity(text: string): number {
  if (!text || text.trim().length === 0) return 0;

  const patterns = [
    /^#{1,6}\s+/mg,        // Headings
    /\*\*[^*]+\*\*/g,      // Bold
    /__[^_]+__/g,          // Bold alt
    /\*[^*\s][^*]*\*/g,    // Italic
    /_[^_\s][^_]*_/g,      // Italic alt
    /~~[^~]+~~/g,          // Strikethrough
    /^\s*[-*+•]\s+/mg,      // List items
    /^\s*\d+\.\s+/mg,      // Numbered list
    /^\s*>\s+/mg,          // Blockquote
    /`[^`]+`/g,            // Inline code
    /\[([^\]]+)\]\(([^)]+)\)/g, // Links
  ];

  let totalMatches = 0;

  for (const pattern of patterns) {
    const matches = text.match(pattern);

    if (matches) {
      totalMatches += matches.length;
    }
  }

  // Normalize by text length (rough heuristic)
  const lines = text.split('\n').length;
  const density = Math.min(totalMatches / (lines * 0.5), 1);

  return density;
}

/**
 * Checks if text is likely plain text (not Markdown)
 * @param text Text to check
 * @returns True if text is likely plain text
 */
export function isPlainText(text: string): boolean {
  return !detectMarkdown(text);
}

/**
 * Detects if plain text is likely TSV (Tab Separated Values)
 * @param text Plain text string
 * @returns True if text is likely TSV
 */
export function detectTSV(text: string): boolean {
  if (!text || text.trim().length === 0) return false;

  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);

  // Must have at least 2 lines for a table (header + data)
  if (lines.length < 2) return false;

  // Count lines with tabs
  const linesWithTabs = lines.filter((line) => line.includes('\t'));

  // Should have consistent column count (roughly)
  // But simple check: at least 75% of lines have tabs
  return linesWithTabs.length >= lines.length * 0.75;
}
