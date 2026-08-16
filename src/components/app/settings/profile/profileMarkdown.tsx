import { Fragment, ReactNode } from 'react';

/**
 * Minimal inline-markdown renderer for the "About me" preview.
 *
 * Desktop renders the bio with block syntaxes disabled and only inline ones enabled
 * (see profile_description_markdown_render.dart), so this deliberately supports just
 * links, bold, italic, strikethrough and inline code. Output is React nodes, never raw
 * HTML, so user text cannot inject markup.
 */

// Ordered by precedence; each pattern has exactly one capture group for the content
// (links have two: text and href).
const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/;
const BOLD = /\*\*([^*]+)\*\*|__([^_]+)__/;
const STRIKE = /~~([^~]+)~~/;
const CODE = /`([^`]+)`/;
const ITALIC = /\*([^*]+)\*|_([^_]+)_/;

const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;
const PARAGRAPH_BREAK = /\n+/;

function isSafeHref(href: string): boolean {
  // Block javascript:/data: and friends; allow relative and http(s)/mailto.
  return SAFE_HREF.test(href);
}

// Hoisted: parseInline recurses, so rebuilding this per call allocates once per nesting level.
const INLINE_RULES: Array<[RegExp, (content: ReactNode[], k: string) => ReactNode]> = [
  [BOLD, (content, k) => <strong key={k}>{content}</strong>],
  [STRIKE, (content, k) => <s key={k}>{content}</s>],
  [CODE, (content, k) => <code key={k}>{content}</code>],
  [ITALIC, (content, k) => <em key={k}>{content}</em>],
];

function parseInline(text: string, key = 0): ReactNode[] {
  if (!text) return [];

  const link = LINK.exec(text);

  if (link) {
    const href = link[2];
    const before = text.slice(0, link.index);
    const after = text.slice(link.index + link[0].length);

    return [
      ...parseInline(before, key),
      isSafeHref(href) ? (
        <a
          key={`a-${key}-${link.index}`}
          href={href}
          target='_blank'
          rel='noreferrer noopener'
          className='text-text-action underline'
        >
          {parseInline(link[1], key + 1)}
        </a>
      ) : (
        <Fragment key={`a-${key}-${link.index}`}>{link[0]}</Fragment>
      ),
      ...parseInline(after, key + 1),
    ];
  }

  for (const [pattern, render] of INLINE_RULES) {
    const match = pattern.exec(text);

    if (!match) continue;

    const inner = match[1] ?? match[2] ?? '';
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    // Inline code is literal — don't recurse into it.
    const content = pattern === CODE ? [inner as ReactNode] : parseInline(inner, key + 1);

    return [...parseInline(before, key), render(content, `m-${key}-${match.index}`), ...parseInline(after, key + 1)];
  }

  return [text];
}

export function renderProfileMarkdown(text: string): ReactNode {
  return text.split(PARAGRAPH_BREAK).map((line, index) => (
    <p key={index} className='whitespace-pre-wrap break-words'>
      {parseInline(line)}
    </p>
  ));
}

export default renderProfileMarkdown;
