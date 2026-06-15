import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { ReactComponent as CodeSvg } from '@/assets/icons/inline_code.svg';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import { createHotKeyLabel, HOT_KEY_NAME } from '@/utils/hotkeys';

export function InlineCode() {
  const { t } = useTranslation();
  const editor = useSlateStatic();
  const isActivated = CustomEditor.isMarkActive(editor, EditorMarkFormat.Code);
  const modifier = useMemo(() => createHotKeyLabel(HOT_KEY_NAME.CODE), []);

  const onClick = useCallback(() => {
    CustomEditor.toggleMark(editor, {
      key: EditorMarkFormat.Code,
      value: true,
    });
  }, [editor]);

  return (
    <ActionButton
      onClick={onClick}
      active={isActivated}
      data-testid="toolbar-code-button"
      tooltip={
        <>
          <div>{t('editor.embedCode')}</div>
          <div className={'text-xs text-text-secondary'}>{modifier}</div>
        </>
      }
    >
      <CodeSvg className='h-4 w-4' />
    </ActionButton>
  );
}

export default InlineCode;
