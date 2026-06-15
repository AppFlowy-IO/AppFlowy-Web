import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { ReactComponent as StrikeThroughSvg } from '@/assets/icons/strikethrough.svg';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import { createHotKeyLabel, HOT_KEY_NAME } from '@/utils/hotkeys';

export function StrikeThrough() {
  const { t } = useTranslation();
  const editor = useSlateStatic();
  const isActivated = CustomEditor.isMarkActive(editor, EditorMarkFormat.StrikeThrough);
  const modifier = useMemo(() => createHotKeyLabel(HOT_KEY_NAME.STRIKETHROUGH), []);

  const onClick = useCallback(() => {
    CustomEditor.toggleMark(editor, {
      key: EditorMarkFormat.StrikeThrough,
      value: true,
    });
  }, [editor]);

  return (
    <ActionButton
      onClick={onClick}
      active={isActivated}
      data-testid="toolbar-strikethrough-button"
      tooltip={
        <>
          <div>{t('editor.strikethrough')}</div>
          <div className={'text-xs text-text-secondary'}>{modifier}</div>
        </>
      }
    >
      <StrikeThroughSvg className='h-4 w-4' />
    </ActionButton>
  );
}

export default StrikeThrough;
