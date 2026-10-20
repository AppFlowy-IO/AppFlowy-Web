import { BlockType, MathEquationBlockData } from '@/application/types';
import { MathEquationAIAction } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';
import { ParsedBlock } from '@/components/editor/parsers/types';
import { unwrapMathMarkdown } from '@/components/editor/utils/math-markdown';

// Matches the desktop equation writer commands, using the existing custom-prompt API.
export const equationPrompts: Record<MathEquationAIAction, string> = {
  generate:
    'You are a professional mathematician creating or refining formulas. Satisfy the user request by editing or extending the equation directly. Preserve unrelated content and the original notation. Return the resulting LaTeX equation in a $$ display math block. Answer in the same language as the user.',
  explain:
    'You are an expert maths educator. Explain every symbol, the structure, key properties, domain restrictions, and useful applications of the supplied equation. Be concise and use the same language as the user. Use $...$ for inline math and $$ display blocks for equations.',
  check:
    'You are a formula proofreader. Check syntax, notation, mathematical flaws, undefined variables and domain restrictions. Preserve the original layout and notation unless a correction requires a change. If no issues are found, say "No change is required". Otherwise return the fully corrected equation in a $$ display math block and briefly explain the corrections in the user\'s language.',
};

export function parseEquationResponse(markdown: string): ParsedBlock[] {
  const convert = (block: ParsedBlock): ParsedBlock => {
    if (
      block.type === BlockType.CodeBlock &&
      /^(latex|tex|math)$/i.test((block.data as { language: string }).language)
    ) {
      return {
        type: BlockType.EquationBlock,
        data: { formula: unwrapMathMarkdown(block.text).trim() } as MathEquationBlockData,
        text: '',
        formats: [],
        children: [],
      };
    }

    return { ...block, children: block.children.map(convert) };
  };

  return parseMarkdown(markdown).map(convert);
}

export function extractGeneratedEquation(markdown: string): string | undefined {
  const blocks = parseEquationResponse(markdown);
  const equations = blocks
    .filter((block) => block.type === BlockType.EquationBlock)
    .map((block) => (block.data as { formula: string }).formula)
    .filter((formula) => formula.trim());

  if (equations.length) return equations.join('\n');
  const inline = blocks
    .flatMap((block) =>
      block.formats.filter((format) => format.type === 'formula').map((format) => format.data?.formula)
    )
    .filter(Boolean);

  // Prose mentioning a variable is not a replacement equation.
  return inline.length === 1 && blocks.length === 1 && blocks[0].text.trim() === '$' ? inline[0] : undefined;
}
