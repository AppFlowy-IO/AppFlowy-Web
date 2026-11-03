export const DEFAULT_MERMAID_CODE = 'graph TD\n  Mermaid --> Diagram';

/** Flutter's language set, including aliases persisted by older desktop/web clients. */
export const supportLanguages = [
  { id: 'auto', title: 'Auto' },
  { id: 'assembly', title: 'Assembly' },
  { id: 'bash', title: 'Bash' },
  { id: 'basic', title: 'Basic' },
  { id: 'c', title: 'C' },
  { id: 'cs', title: 'C#' },
  { id: 'clojure', title: 'Clojure' },
  { id: 'cpp', title: 'C++' },
  { id: 'css', title: 'CSS' },
  { id: 'dart', title: 'Dart' },
  { id: 'delphi', title: 'Delphi' },
  { id: 'docker', title: 'Docker' },
  { id: 'elixir', title: 'Elixir' },
  { id: 'elm', title: 'Elm' },
  { id: 'erlang', title: 'Erlang' },
  { id: 'fortran', title: 'Fortran' },
  { id: 'go', title: 'Go' },
  { id: 'graphql', title: 'GraphQL' },
  { id: 'haskell', title: 'Haskell' },
  { id: 'html', title: 'HTML' },
  { id: 'java', title: 'Java' },
  { id: 'javascript', title: 'JavaScript' },
  { id: 'json', title: 'JSON' },
  { id: 'kotlin', title: 'Kotlin' },
  { id: 'latex', title: 'LaTeX' },
  { id: 'lisp', title: 'Lisp' },
  { id: 'lua', title: 'Lua' },
  { id: 'markdown', title: 'Markdown' },
  { id: 'matlab', title: 'MATLAB' },
  { id: 'mermaid', title: 'Mermaid' },
  { id: 'objective-c', title: 'Objective-C' },
  { id: 'ocaml', title: 'OCaml' },
  { id: 'perl', title: 'Perl' },
  { id: 'php', title: 'PHP' },
  { id: 'plaintext', title: 'Plain text' },
  { id: 'powershell', title: 'PowerShell' },
  { id: 'python', title: 'Python' },
  { id: 'r', title: 'R' },
  { id: 'ruby', title: 'Ruby' },
  { id: 'rust', title: 'Rust' },
  { id: 'scala', title: 'Scala' },
  { id: 'shell', title: 'Shell' },
  { id: 'sql', title: 'SQL' },
  { id: 'swift', title: 'Swift' },
  { id: 'typescript', title: 'TypeScript' },
  { id: 'verilog', title: 'Verilog' },
  { id: 'vhdl', title: 'VHDL' },
  { id: 'visual basic', title: 'Visual Basic' },
  { id: 'xml', title: 'XML' },
  { id: 'yaml', title: 'YAML' },
  { id: 'zig', title: 'Zig' },
];

const aliases: Record<string, string> = {
  '': 'auto',
  'plain text': 'plaintext',
  text: 'plaintext',
  txt: 'plaintext',
  csharp: 'cs',
  'c#': 'cs',
  'c++': 'cpp',
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  pascal: 'delphi',
  dockerfile: 'docker',
  objectivec: 'objective-c',
  vbnet: 'visual basic',
  tex: 'latex',
  asm: 'assembly',
};

export function normalizeCodeLanguage(language?: string | null): string {
  const value = (language ?? '').trim().toLowerCase();

  return aliases[value] ?? value;
}

export function filterCodeLanguages(search: string) {
  const query = search.trim().toLowerCase();
  const alias = aliases[query];

  return supportLanguages.filter(
    ({ id, title }) => id.includes(query) || title.toLowerCase().includes(query) || id === alias
  );
}

export function codeLanguageLabel(language?: string | null) {
  const value = normalizeCodeLanguage(language);

  return supportLanguages.find(({ id }) => id === value)?.title ?? language ?? 'Auto';
}
