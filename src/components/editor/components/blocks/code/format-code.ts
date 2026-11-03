import { Editor, Node, Transforms } from 'slate';

import { YjsEditor } from '@/application/slate-yjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { CodeNode } from '@/components/editor/editor.type';

import { normalizeCodeLanguage } from './constants';

const parsers: Record<string, string> = {
  javascript: 'babel',
  typescript: 'typescript',
  json: 'json',
  css: 'css',
  html: 'html',
  markdown: 'markdown',
  yaml: 'yaml',
  graphql: 'graphql',
};

export const canFormatCode = (language: string) => !!parsers[normalizeCodeLanguage(language)];

export async function formatCode(editor: YjsEditor, source: CodeNode) {
  const parser = parsers[normalizeCodeLanguage(source.data.language)];

  if (!parser || !YjsEditor.connected(editor) || editor.readOnly) return;
  const text = Node.string(source);
  const [{ format }, plugin] = await Promise.all([
    import('prettier/standalone'),
    {
      babel: () => import('prettier/parser-babel'),
      typescript: () => import('prettier/parser-typescript'),
      json: () => import('prettier/parser-babel'),
      css: () => import('prettier/parser-postcss'),
      html: () => import('prettier/parser-html'),
      markdown: () => import('prettier/parser-markdown'),
      yaml: () => import('prettier/parser-yaml'),
      graphql: () => import('prettier/parser-graphql'),
    }[parser]!(),
  ]);
  const entry = findSlateEntryByBlockId(editor, source.blockId);

  // Navigation, permission changes and newer edits invalidate deferred work.
  if (
    !YjsEditor.connected(editor) ||
    !entry ||
    entry[0].type !== BlockType.CodeBlock ||
    editor.readOnly ||
    editor.isElementReadOnly(entry[0]) ||
    Node.string(entry[0]) !== text ||
    (entry[0] as CodeNode).data.language !== source.data.language
  )
    return;
  const formatted = format(text, { parser, plugins: [plugin.default], tabWidth: 2 }).replace(/\n$/, '');

  if (formatted !== text) Transforms.insertText(editor, formatted, { at: Editor.range(editor, entry[1].concat(0)) });
}
