import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { ReactComponent as UnderlineSvg } from '@/assets/icons/underline.svg';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import { createHotKeyLabel, HOT_KEY_NAME } from '@/utils/hotkeys';

export function Underline() {
  const { t } = useTranslation();
  const editor = useSlateStatic();
  const isActivated = CustomEditor.isMarkActive(editor, EditorMarkFormat.Underline);
  const modifier = useMemo(() => createHotKeyLabel(HOT_KEY_NAME.UNDERLINE), []);

  const onClick = useCallback(() => {
    CustomEditor.toggleMark(editor, {
      key: EditorMarkFormat.Underline,
      value: true,
    });
  }, [editor]);

  return (
    <ActionButton
      onClick={onClick}
      active={isActivated}
      data-testid="toolbar-underline-button"
      tooltip={
        <>
          <div>{t('editor.underline')}</div>
          <div className={'text-xs text-text-secondary'}>{modifier}</div>
        </>
      }
    >
      <UnderlineSvg className='h-4 w-4' />
    </ActionButton>
  );
}

export default Underline;
