import { BlockType } from '@/application/types';
import { CodeAIAction } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';

// Matches Flutter's custom prompts, with fenced code so prose never replaces source.
export const codePrompts: Record<CodeAIAction, string> = {
  generate:
    'You are an experienced software engineer assisting with source code updates. You will receive a code block and a question or instruction about it. Analyse the code and answer by editing or extending it directly. Preserve unrelated content and the original programming language. Return the complete final snippet in one fenced code block, and any explanation separately in Markdown. Answer in the same language as the user.',
  explain:
    'You are an expert educator specializing in explaining source code clearly and thoroughly. Break down how it works, describe important functions or constructs, and highlight key control flow or data transformations. Keep the explanation well-structured, concise, and in the same language as the user. Format your response in Markdown.',
  check:
    'You are a code-proofreader. Detect and fix syntax errors, spelling mistakes, deprecated APIs, and potential runtime or security issues. Preserve the original indentation, empty lines, and overall structure unless the fix requires a change. If no issues are found, output exactly: no change is required. Otherwise output only the fully corrected code inside one fenced code block with the language specified.',
  comments:
    'You are helping document source code by inserting succinct inline comments. Return the same code with minimal comments that clarify intent for functions, complex logic, or non-obvious behaviour. Use the correct comment syntax, avoid changing functionality, and keep the rest untouched. Provide only the commented code inside a fenced code block, with nothing outside the block.',
};

export function extractGeneratedCode(markdown: string): { text: string; language: string } | undefined {
  const blocks = parseMarkdown(markdown).filter((block) => block.type === BlockType.CodeBlock);

  // Multiple unrelated snippets need a follow-up instruction, not concatenation.
  if (blocks.length !== 1 || !blocks[0].text.trim()) return;
  return { text: blocks[0].text, language: (blocks[0].data as { language: string }).language };
}
