import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { CalloutNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { cn } from '@/lib/utils';
import { renderColor } from '@/utils/color';
import { isFlagEmoji } from '@/utils/emoji';

import { CALLOUT_ICON_VERSION, calloutIconUpdate, getCalloutColors, getCalloutIcon } from './callout.utils';
import { CalloutGlyph } from './CalloutGlyph';

function CalloutIcon({ block: node }: { block: CalloutNode; className?: string }) {
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly() || editor.isElementReadOnly(node);
  const { uploadFile } = useEditorContext();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const icon = getCalloutIcon(node.data);
  const colors = getCalloutColors(node.data);

  if (!icon) return null;

  return (
    <CustomIconPopover
      open={open}
      onOpenChange={setOpen}
      onSelectIcon={(selected) => {
        CustomEditor.setBlockData(editor, node.blockId, calloutIconUpdate(selected));
        setOpen(false);
      }}
      removeIcon={() => {
        CustomEditor.setBlockData(editor, node.blockId, { icon: '', icon_type: 'icon', version: CALLOUT_ICON_VERSION });
        setOpen(false);
      }}
      defaultActiveTab={icon.type === 'custom' ? 'upload' : icon.type}
      tabs={['emoji', 'icon', 'upload']}
      onUploadFile={uploadFile}
      enable={!readOnly}
    >
      <button
        type='button'
        aria-label={t('document.callout.changeIcon')}
        disabled={readOnly}
        data-testid='callout-icon-button'
        contentEditable={false}
        onMouseDown={(event) => event.preventDefault()}
        className={cn(
          'mr-2 flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-[6px] outline-none',
          !readOnly &&
            'hover:bg-[var(--callout-icon-hover)] focus-visible:bg-[var(--callout-icon-hover)] focus-visible:ring-2 focus-visible:ring-border-theme-thick'
        )}
        style={{ '--callout-icon-hover': renderColor(colors.bgHover) } as React.CSSProperties}
      >
        {icon.type === 'emoji' ? (
          <span className={isFlagEmoji(icon.value) ? 'icon' : undefined}>{icon.value}</span>
        ) : icon.type === 'custom' ? (
          <img src={icon.value} alt='' className='h-5 w-5 object-contain' draggable={false} />
        ) : (
          <CalloutGlyph id={icon.value} color={icon.color || colors.icon} />
        )}
      </button>
    </CustomIconPopover>
  );
}

export default React.memo(CalloutIcon);
