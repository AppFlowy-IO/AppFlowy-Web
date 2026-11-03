import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import basic from 'highlight.js/lib/languages/basic';
import c from 'highlight.js/lib/languages/c';
import clojure from 'highlight.js/lib/languages/clojure';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import delphi from 'highlight.js/lib/languages/delphi';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import elixir from 'highlight.js/lib/languages/elixir';
import elm from 'highlight.js/lib/languages/elm';
import erlang from 'highlight.js/lib/languages/erlang';
import fortran from 'highlight.js/lib/languages/fortran';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import haskell from 'highlight.js/lib/languages/haskell';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import latex from 'highlight.js/lib/languages/latex';
import lisp from 'highlight.js/lib/languages/lisp';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import matlab from 'highlight.js/lib/languages/matlab';
import objectivec from 'highlight.js/lib/languages/objectivec';
import ocaml from 'highlight.js/lib/languages/ocaml';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import vbnet from 'highlight.js/lib/languages/vbnet';
import verilog from 'highlight.js/lib/languages/verilog';
import vhdl from 'highlight.js/lib/languages/vhdl';
import x86asm from 'highlight.js/lib/languages/x86asm';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

import { setCodeHighlighter } from './syntax-highlighter';

// An owned registry avoids global Prism collisions with embedded editors.
const highlighter = hljs.newInstance();

highlighter.registerLanguage('assembly', x86asm);
highlighter.registerLanguage('bash', bash);
highlighter.registerLanguage('basic', basic);
highlighter.registerLanguage('c', c);
highlighter.registerLanguage('cs', csharp);
highlighter.registerLanguage('clojure', clojure);
highlighter.registerLanguage('cpp', cpp);
highlighter.registerLanguage('css', css);
highlighter.registerLanguage('dart', dart);
highlighter.registerLanguage('delphi', delphi);
highlighter.registerLanguage('docker', dockerfile);
highlighter.registerLanguage('elixir', elixir);
highlighter.registerLanguage('elm', elm);
highlighter.registerLanguage('erlang', erlang);
highlighter.registerLanguage('fortran', fortran);
highlighter.registerLanguage('go', go);
highlighter.registerLanguage('graphql', graphql);
highlighter.registerLanguage('haskell', haskell);
highlighter.registerLanguage('html', xml);
highlighter.registerLanguage('java', java);
highlighter.registerLanguage('javascript', javascript);
highlighter.registerLanguage('json', json);
highlighter.registerLanguage('kotlin', kotlin);
highlighter.registerLanguage('latex', latex);
highlighter.registerLanguage('lisp', lisp);
highlighter.registerLanguage('lua', lua);
highlighter.registerLanguage('markdown', markdown);
highlighter.registerLanguage('matlab', matlab);
highlighter.registerLanguage('objective-c', objectivec);
highlighter.registerLanguage('ocaml', ocaml);
highlighter.registerLanguage('perl', perl);
highlighter.registerLanguage('php', php);
highlighter.registerLanguage('powershell', powershell);
highlighter.registerLanguage('python', python);
highlighter.registerLanguage('r', r);
highlighter.registerLanguage('ruby', ruby);
highlighter.registerLanguage('rust', rust);
highlighter.registerLanguage('scala', scala);
highlighter.registerLanguage('shell', shell);
highlighter.registerLanguage('sql', sql);
highlighter.registerLanguage('swift', swift);
highlighter.registerLanguage('typescript', typescript);
highlighter.registerLanguage('verilog', verilog);
highlighter.registerLanguage('vhdl', vhdl);
highlighter.registerLanguage('visual basic', vbnet);
highlighter.registerLanguage('xml', xml);
highlighter.registerLanguage('yaml', yaml);

// Flutter ships these two grammars in appflowy_editor_plugins.
highlighter.registerLanguage('mermaid', () => ({
  keywords:
    'graph flowchart subgraph end direction TB TD BT RL LR sequenceDiagram participant actor activate deactivate Note note over loop alt else opt par and rect critical option break autonumber stateDiagram stateDiagram-v2 state classDiagram class entityRelationship erDiagram gantt dateFormat title section journey pie gitGraph commit branch checkout merge mindmap timeline quadrantChart xychart-beta block-beta architecture-beta packet-beta',
  contains: [
    { scope: 'comment', begin: /%%/, end: /$/ },
    { scope: 'string', begin: /"/, end: /"/ },
    { scope: 'operator', begin: /[-=.]+(?:>|o|x)|<[-=.]+|:::/ },
    { scope: 'number', begin: /\b\d+(?:\.\d+)?\b/ },
  ],
}));
highlighter.registerLanguage('zig', (hljs) => ({
  keywords:
    'void bool i8 u8 i16 u16 i32 u32 i64 u64 i128 u128 isize usize f16 f32 f64 f128 anytype anyframe noreturn type error comptime_int comptime_float const var extern packed export pub fn inline noinline callconv volatile allowzero align linksection threadlocal struct enum union opaque try catch orelse errdefer defer async await suspend resume cancel nosuspend if else switch while for break continue return usingnamespace test or and not xor comptime',
  contains: [
    hljs.C_LINE_COMMENT_MODE,
    hljs.C_BLOCK_COMMENT_MODE,
    hljs.QUOTE_STRING_MODE,
    hljs.APOS_STRING_MODE,
    { scope: 'number', begin: /\b(?:0[bBoOxX][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?[\d_]+)?)/, relevance: 0 },
    { scope: 'built_in', begin: /@[A-Za-z_]\w*/ },
  ],
}));

setCodeHighlighter(highlighter);
export default highlighter;
