import { forwardRef, lazy, memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { BlockType } from '@/application/types';
import { ReactComponent as MathSvg } from '@/assets/icons/math-equation/formula.svg';
import { KatexMath } from '@/components/_shared/katex-math';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { EditorElementProps, MathEquationNode } from '@/components/editor/editor.type';
import { useBlockSelected } from '@/components/editor/EditorContext';

import MathEquationToolbar from './MathEquationToolbar';
import './math-equation.scss';

const MathEquationAI = lazy(() => import('./MathEquationAI'));

export const MathEquation = memo(
  forwardRef<HTMLDivElement, EditorElementProps<MathEquationNode>>(
    ({ node, children, className, ...attributes }, ref) => {
      const formula = node.data.formula || '';
      const editor = useSlateStatic();
      const selected = useBlockSelected(node.blockId);
      const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
      const { t } = useTranslation();
      const { openPopover, blockId, mathEquationAI, closeMathEquationAI } = usePopoverContext();
      const aiSession = mathEquationAI?.blockId === node.blockId ? mathEquationAI : undefined;
      const openEditor = () => {
        if (!readOnly) openPopover(node.blockId, BlockType.EquationBlock);
      };

      return (
        <div {...attributes} className={`${className || ''} math-equation-block relative w-full`}>
          <div
            className={`math-equation-surface relative min-h-[44px] rounded-lg ${!formula.trim() ? 'is-empty' : ''} ${
              blockId === node.blockId || aiSession ? 'is-active' : ''
            } ${selected ? 'is-selected' : ''}`}
          >
            <div
              contentEditable={false}
              role={readOnly ? undefined : 'button'}
              tabIndex={readOnly ? undefined : 0}
              aria-label={t(
                formula
                  ? 'document.plugins.mathEquation.editMathEquation'
                  : 'document.plugins.mathEquation.addMathEquation'
              )}
              className={`min-h-[44px] rounded-lg py-2 pl-3 pr-10 outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick ${
                readOnly ? '' : 'cursor-pointer'
              }`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openEditor();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  openEditor();
                }
              }}
            >
              {formula.trim() ? (
                <div className='math-equation-render flex min-h-[28px] w-full items-center justify-center overflow-x-auto'>
                  <Suspense fallback={formula}>
                    <KatexMath latex={formula} />
                  </Suspense>
                </div>
              ) : (
                <div className='flex min-h-[28px] items-center gap-2 text-sm text-text-tertiary'>
                  <MathSvg width={20} height={20} />
                  {t('document.plugins.mathEquation.addMathEquation')}
                </div>
              )}
            </div>
            <div className='math-equation-toolbar'>
              <MathEquationToolbar node={node} readOnly={readOnly} />
            </div>
          </div>
          <div
            ref={ref}
            className='pointer-events-none absolute h-0 w-0 overflow-hidden text-transparent caret-transparent'
          >
            {children}
          </div>
          {!readOnly && aiSession && (
            <Suspense fallback={null}>
              <MathEquationAI
                key={`${node.blockId}-${aiSession.id}-${aiSession.action}`}
                node={node}
                session={aiSession}
                onClose={() => closeMathEquationAI?.()}
              />
            </Suspense>
          )}
        </div>
      );
    }
  )
);

export default MathEquation;
