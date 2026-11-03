import { normalizeCodeLanguage } from '@/components/editor/components/blocks/code/constants';
import { decorateCode } from '@/components/editor/components/blocks/code/utils';

import type { HLJSApi } from 'highlight.js';

// The editor detects an Auto block's language from the same leading sample.
const AUTO_SAMPLE_LENGTH = 5000;

export interface CodeToken {
  text: string;
  /** The editor's Prism-style token names; empty for text outside a token. */
  token: string;
}

/** Plain text, Mermaid and empty Auto blocks never load the editor's grammars. */
export function highlightsCode(text: string, language?: string) {
  const value = normalizeCodeLanguage(language);

  if (value === 'plaintext' || value === 'mermaid') return false;
  return value !== 'auto' || !!text.slice(0, AUTO_SAMPLE_LENGTH).trim();
}

/** The grammar the editor uses: the block's language, or Auto detection; unknown languages stay plain. */
export function codeGrammar(highlighter: HLJSApi, text: string, language?: string) {
  const value = normalizeCodeLanguage(language);
  const detected =
    value === 'auto' ? highlighter.highlightAuto(text.slice(0, AUTO_SAMPLE_LENGTH)).language ?? 'plaintext' : value;
  const grammar = normalizeCodeLanguage(detected);

  return highlighter.getLanguage(grammar) ? grammar : 'plaintext';
}

/** Split code into the editor's highlight ranges, keeping every source character. */
export function tokenizeCode(text: string, grammar: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let offset = 0;

  for (const range of decorateCode([{ text }, [0]], grammar)) {
    // The editor's ranges are contiguous; anything else leaves the source unhighlighted.
    if (range.anchor.offset !== offset) return [{ text, token: '' }];
    tokens.push({ text: text.slice(offset, range.focus.offset), token: range.prism_token });
    offset = range.focus.offset;
  }

  if (offset < text.length) tokens.push({ text: text.slice(offset), token: '' });
  return tokens;
}
