import { memo, useMemo } from 'react';

import { StaticBlocks } from '@/components/editor/components/static/static-blocks';

import { parseEquationResponse } from './math-equation-ai';
import './math-equation-ai.scss';

const CLASS_NAMES = { math: 'equation-response-math', table: 'equation-response-table', taskList: 'task-list' };

export const MathEquationResponse = memo(function MathEquationResponse({ content }: { content: string }) {
  const blocks = useMemo(() => parseEquationResponse(content), [content]);

  return (
    <div className='math-equation-response' data-testid='math-equation-response'>
      <StaticBlocks blocks={blocks} classNames={CLASS_NAMES} />
    </div>
  );
});
