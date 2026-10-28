import { languages, tokenize, type Token } from 'prismjs';

import { normalizeCodeLanguage } from '@/components/editor/components/blocks/code/constants';

// Bundled with the lazy code renderer, in Prism dependency order. No CDN scripts.
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-basic';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-clojure';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-dart';
import 'prismjs/components/prism-elixir';
import 'prismjs/components/prism-elm';
import 'prismjs/components/prism-erlang';
import 'prismjs/components/prism-fortran';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-haskell';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-lisp';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-matlab';
import 'prismjs/components/prism-ocaml';
import 'prismjs/components/prism-perl';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-scala';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-mermaid';
import 'prismjs/components/prism-pascal';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-latex';
import 'prismjs/components/prism-nasm';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-objectivec';
import 'prismjs/components/prism-verilog';
import 'prismjs/components/prism-vhdl';
import 'prismjs/components/prism-vbnet';
import 'prismjs/components/prism-zig';

const ALIASES: Record<string, string> = {
  auto: 'plaintext',
  assembly: 'nasm',
  'objective-c': 'objectivec',
  'visual basic': 'vbnet',
  js: 'javascript',
  ts: 'typescript',
  html: 'markup',
  xml: 'markup',
  shell: 'bash',
  sh: 'bash',
  cs: 'csharp',
  'c#': 'csharp',
  'c++': 'cpp',
  delphi: 'pascal',
  tex: 'latex',
};

export function codeLanguage(language?: string) {
  const value = normalizeCodeLanguage(language);

  return ALIASES[value] ?? value;
}

export function tokenizeCode(text: string, language?: string): Array<string | Token> {
  const grammar = languages[codeLanguage(language)];

  if (!grammar) return [text];
  try {
    return tokenize(text, grammar);
  } catch {
    return [text];
  }
}
