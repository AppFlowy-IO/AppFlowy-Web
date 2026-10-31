import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as MathSvg } from '@/assets/icons/math-equation/formula.svg';
import { KatexMath } from '@/components/_shared/katex-math';

import './math-equation.scss';

/** Native math layout without editor actions or a document mutation path. */
export function MathEquationContent({ formula }: { formula: string }) {
  const { t } = useTranslation();

  return formula.trim() ? (
    <div className='math-equation-render flex min-h-[44px] w-full items-center justify-center overflow-x-auto'>
      <Suspense fallback={formula}>
        <KatexMath latex={formula} />
      </Suspense>
    </div>
  ) : (
    <div className='flex min-h-[28px] items-center gap-2 text-sm text-text-tertiary'>
      <MathSvg width={20} height={20} />
      {t('document.plugins.mathEquation.addMathEquation')}
    </div>
  );
}
