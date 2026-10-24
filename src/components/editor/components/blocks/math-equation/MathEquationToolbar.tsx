import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/math-equation/more.svg';
import { notify } from '@/components/_shared/notify';
import { MathEquationNode } from '@/components/editor/editor.type';
import { Button } from '@/components/ui/button';
import { copyTextToClipboard } from '@/utils/copy';

import { MathEquationMenu } from './MathEquationMenu';

function MathEquationToolbar({ node, readOnly }: { node: MathEquationNode; readOnly: boolean }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <div contentEditable={false} onClick={(e) => e.stopPropagation()} className='absolute right-2 top-2 z-10'>
      {readOnly ? (
        node.data.formula && (
          <Button
            variant='ghost'
            size='icon'
            aria-label={t('editor.copy')}
            onClick={() => {
              void copyTextToClipboard(node.data.formula || '').then(() => notify.success(t('publish.copy.mathBlock')));
            }}
          >
            <CopyIcon className='h-5 w-5' />
          </Button>
        )
      ) : (
        <>
          <Button
            variant='ghost'
            size='icon'
            aria-label={t('document.plugins.mathEquation.options')}
            data-testid='math-equation-options'
            onClick={(event) => setAnchor(event.currentTarget)}
          >
            <MoreIcon width={20} height={20} />
          </Button>
          {anchor && <MathEquationMenu node={node} anchorEl={anchor} onClose={() => setAnchor(null)} />}
        </>
      )}
    </div>
  );
}

export default MathEquationToolbar;
