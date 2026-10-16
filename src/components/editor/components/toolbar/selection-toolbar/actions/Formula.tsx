import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlate } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { ReactComponent as MathSvg } from '@/assets/icons/formula.svg';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';
import { toggleInlineEquation } from '@/components/editor/utils/math-equation';


function Formula() {
  const { t } = useTranslation();
  const editor = useSlate() as YjsEditor;
  const { visible } = useSelectionToolbarContext();
  const [state, setState] = React.useState({
    isActivated: false,
    hasFormulaActivated: false,
    hasMentionActivated: false,
  });

  const { isActivated, hasFormulaActivated, hasMentionActivated } = state;

  const getState = useCallback(() => {
    const isActivated = CustomEditor.isMarkActive(editor, EditorMarkFormat.Formula);
    const hasFormulaActivated = CustomEditor.hasMark(editor, EditorMarkFormat.Formula);
    const hasMentionActivated = CustomEditor.hasMark(editor, EditorMarkFormat.Mention);

    return {
      isActivated,
      hasFormulaActivated,
      hasMentionActivated,
    };
  }, [editor]);

  useEffect(() => {
    if (!visible) return;
    setState(getState());
  }, [visible, getState, editor.selection]);

  const onClick = useCallback(() => {
    toggleInlineEquation(editor);

    setState(getState());
  }, [editor, getState]);

  return (
    <ActionButton
      onClick={onClick}
      active={isActivated}
      disabled={!isActivated && (hasFormulaActivated || hasMentionActivated)}
      data-testid="toolbar-formula-button"
      tooltip={t('document.plugins.createInlineMathEquation')}
    >
      <MathSvg className='h-4 w-4' />
    </ActionButton>
  );
}

export default Formula;
