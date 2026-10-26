import type { HLJSApi } from 'highlight.js';

let highlighter: HLJSApi | undefined;

export function setCodeHighlighter(value: HLJSApi) {
  highlighter = value;
}

export function getCodeHighlighter() {
  return highlighter;
}
