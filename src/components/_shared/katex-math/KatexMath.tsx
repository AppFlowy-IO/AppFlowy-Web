import 'katex/dist/katex.min.css';
import { BlockMath, InlineMath } from 'react-katex';

import './index.css';
import { prepareMathLatex } from './prepareMathLatex';

function KatexMath({ latex, isInline = false }: { latex: string; isInline?: boolean }) {
  return isInline ? (
    <InlineMath
      renderError={(error) => {
        return (
          <span role='status' className='break-words text-text-error'>
            {error.message.replace(/^KaTeX parse error: /, '')}
          </span>
        );
      }}
    >
      {latex}
    </InlineMath>
  ) : (
    <BlockMath
      renderError={(error) => {
        return (
          <div role='status' className='min-h-7 break-words text-sm text-text-error'>
            {error.message.replace(/^KaTeX parse error: /, '')}
          </div>
        );
      }}
    >
      {prepareMathLatex(latex)}
    </BlockMath>
  );
}

export default KatexMath;
