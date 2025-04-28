import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ViewIconType } from '@/application/types';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { CalloutNode } from '@/components/editor/editor.type';
import { renderColor } from '@/utils/color';
import { getIcon, isFlagEmoji } from '@/utils/emoji';
import DOMPurify from 'dompurify';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useReadOnly, useSlateStatic } from 'slate-react';
import { Element } from 'slate';

function CalloutIcon ({ block: node }: { block: CalloutNode; className: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const editor = useSlateStatic();
  const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
  const blockId = node.blockId;
  const [iconContent, setIconContent] = React.useState<string | undefined>(undefined);
  const [open, setOpen] = React.useState(false);
  const handleChangeIcon = useCallback((icon: {
    ty: ViewIconType,
    value: string,
    color?: string,
    content?: string
  }) => {
    setOpen(false);
    const iconType = icon.ty === ViewIconType.Icon ? 'icon' : 'emoji';
    let value;

    if (icon.ty === ViewIconType.Icon) {
      value = JSON.stringify({
        color: icon.color,
        groupName: icon.value.split('/')[0],
        iconName: icon.value.split('/')[1],
      });

    } else {
      value = icon.value;
    }

    CustomEditor.setBlockData(editor as YjsEditor, blockId, { icon: value, icon_type: iconType });
  }, [editor, blockId]);

  const handleRemoveIcon = useCallback(() => {
    setOpen(false);
    CustomEditor.setBlockData(editor as YjsEditor, blockId, { icon: null });
  }, [blockId, editor]);

  const data = node.data;

  const emoji = useMemo(() => {
    if (data.icon && data.icon_type !== 'icon') {
      return data.icon;
    }

    return `📌`;
  }, [data]);

  const isFlag = useMemo(() => {
    return emoji ? isFlagEmoji(emoji) : false;
  }, [emoji]);

  useEffect(() => {
    if (data.icon && data.icon_type === 'icon') {
      try {
        const json = JSON.parse(data.icon);
        const id = `${json.groupName}/${json.iconName}`;

        void getIcon(id).then((item) => {
          setIconContent(item?.content.replaceAll('black', renderColor(json.color)).replace('<svg', '<svg width="100%" height="100%"'));
        });
      } catch (e) {
        console.error(e, data.icon);
      }
    } else {
      setIconContent(undefined);
    }
  }, [data.icon, data.icon_type]);
  const icon = useMemo(() => {
    if (iconContent) {
      const cleanSvg = DOMPurify.sanitize(iconContent, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });

      return <span
        style={{
          width: 18,
          height: 18,
        }}
        dangerouslySetInnerHTML={{
          __html: cleanSvg,
        }}
      />;

    }

    return null;
  }, [iconContent]);

  return (
    <CustomIconPopover
      open={open}
      onOpenChange={setOpen}
      onSelectIcon={handleChangeIcon}
      removeIcon={handleRemoveIcon}
      defaultActiveTab={'emoji'}
      tabs={['emoji']}
      enable={!readOnly}
    >
      <span
        data-testid="callout-icon-button"
        contentEditable={false}
        ref={ref}
        className={`${readOnly ? '' : 'cursor-pointer'} relative flex items-start justify-center`}
        style={{
          width: '58px',
          minWidth: '58px',
        }}
      >
        <span
          className={`w-8 ${isFlag ? 'icon' : ''} h-8 absolute -top-[4px] flex text-[18px] items-center justify-center ${readOnly ? '' : 'hover:bg-fill-list-hover rounded-[6px]'}`}
        >{
          icon || emoji
        }</span>

      </span>

    </CustomIconPopover>
  );
}

export default React.memo(CalloutIcon);
