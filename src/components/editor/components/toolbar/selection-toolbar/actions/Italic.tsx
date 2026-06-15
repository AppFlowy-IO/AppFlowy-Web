import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { ReactComponent as ItalicSvg } from '@/assets/icons/italic.svg';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import { createHotKeyLabel, HOT_KEY_NAME } from '@/utils/hotkeys';

export function Italic() {
  const { t } = useTranslation();
  const editor = useSlateStatic();
  const isActivated = CustomEditor.isMarkActive(editor, EditorMarkFormat.Italic);
  const modifier = useMemo(() => createHotKeyLabel(HOT_KEY_NAME.ITALIC), []);

  const onClick = useCallback(() => {
    CustomEditor.toggleMark(editor, {
      key: EditorMarkFormat.Italic,
      value: true,
    });
  }, [editor]);

  return (
    <ActionButton
      onClick={onClick}
      active={isActivated}
      data-testid="toolbar-italic-button"
      tooltip={
        <>
          <div>{t('toolbar.italic')}</div>
          <div className={'text-xs text-text-secondary'}>{modifier}</div>
        </>
      }
    >
      <ItalicSvg className='h-4 w-4' />
    </ActionButton>
  );
}

export default Italic;
