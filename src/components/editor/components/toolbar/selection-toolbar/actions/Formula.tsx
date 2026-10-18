import { useTranslation } from 'react-i18next';
import { useSlate } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { ReactComponent as MathSvg } from '@/assets/icons/formula.svg';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';
import { getSelectedEquationTexts, toggleInlineEquation } from '@/components/editor/utils/math-equation';

function Formula() {
  const { t } = useTranslation();
  const editor = useSlate() as YjsEditor;
  const { visible } = useSelectionToolbarContext();
  const texts = visible ? getSelectedEquationTexts(editor) : [];
  const isActivated = texts.length > 0 && texts.every((node) => node.formula !== undefined);
  const hasFormulaActivated = texts.some((node) => node.formula !== undefined);
  const hasUnsupportedMark = texts.some((node) => node.mention || node.code);

  return (
    <ActionButton
      onClick={() => toggleInlineEquation(editor)}
      active={isActivated}
      disabled={!texts.length || hasUnsupportedMark || (!isActivated && hasFormulaActivated)}
      data-testid="toolbar-formula-button"
      tooltip={t('document.plugins.createInlineMathEquation')}
    >
      <MathSvg className='h-4 w-4' />
    </ActionButton>
  );
}

export default Formula;
