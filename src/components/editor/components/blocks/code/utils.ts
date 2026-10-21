import { BaseRange, NodeEntry, Text } from 'slate';

import { getCodeHighlighter } from './syntax-highlighter';

type TokenRange = BaseRange & { prism_token: string };

/** Convert the highlighter's escaped HTML into Slate ranges without touching the DOM. */
export function decorateCode([node, path]: NodeEntry, language: string): TokenRange[] {
  const highlighter = getCodeHighlighter();

  if (!Text.isText(node) || language === 'plaintext' || !highlighter?.getLanguage(language)) return [];
  try {
    const html = highlighter.highlight(node.text, { language, ignoreIllegals: true }).value;
    // A wrapper retains leading whitespace; character references prevent HTML's CRLF normalization.
    const body = new DOMParser().parseFromString(
      `<body><span>${html.replace(/\r/g, '&#13;')}</span></body>`,
      'text/html'
    ).body;
    const ranges: TokenRange[] = [];
    let offset = 0;
    const visit = (node: globalThis.Node, token: string) => {
      if (node.nodeType === globalThis.Node.TEXT_NODE) {
        const end = offset + (node.textContent?.length ?? 0);

        if (end > offset) ranges.push({ prism_token: token, anchor: { path, offset }, focus: { path, offset: end } });
        offset = end;
      } else {
        const classes =
          node instanceof HTMLElement
            ? [...node.classList].map((name) =>
                name
                  .replace(/^hljs-/, '')
                  .replace(/_$/, '')
                  .replace('built_in', 'builtin')
              )
            : [];
        const next = classes.length ? classes.join(' ') : token;

        node.childNodes.forEach((child) => visit(child, next));
      }
    };

    body.childNodes.forEach((child) => visit(child, ''));
    return ranges;
  } catch {
    return [];
  }
}
