import { ReactComponent as AIGroup } from '@/assets/icons/math-equation/ai-group.svg';

/** The same Figma AI glyph in the editor, action menu and AI input. */
export function MathEquationAIIcon() {
  return (
    <span className='relative inline-block h-5 w-5 shrink-0' aria-hidden>
      <AIGroup width={15.0013} height={16} className='absolute left-[3px] top-0.5' />
    </span>
  );
}
