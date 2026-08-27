import { useCallback, useEffect, useMemo, useState } from 'react';

import { RowMetaKey, useDatabaseContext, useReadOnly } from '@/application/database-yjs';
import { useUpdateCellDispatch, useUpdateRowMetaDispatch } from '@/application/database-yjs/dispatch';
import { RowCoverType, ViewIconType } from '@/application/types';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import AddIconCover from '@/components/view-meta/AddIconCover';
import { cn } from '@/lib/utils';
import { isFlagEmoji } from '@/utils/emoji';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

export function Title({
  icon,
  name,
  rowId,
  fieldId,
  hasCover,
  onEdited,
  templateStyle = false,
}: {
  rowId: string;
  icon?: string;
  name?: string;
  hasCover: boolean;
  fieldId: string;
  onEdited?: (value: string) => void;
  templateStyle?: boolean;
}) {
  const readOnly = useReadOnly();
  const [value, setValue] = useState(name || '');

  useEffect(() => {
    if (name) {
      setValue(name);
    } else {
      setValue('');
    }
  }, [name]);

  const { uploadFile } = useDatabaseContext();
  const updateCell = useUpdateCellDispatch(rowId, fieldId);

  const updateRowMeta = useUpdateRowMetaDispatch(rowId);
  const [isHover, setIsHover] = useState(false);

  const handleUpdateIcon = useCallback(
    ({ value }: { value: string; ty: ViewIconType }) => {
      if (readOnly) return;
      void updateRowMeta(RowMetaKey.IconId, value);
    },
    [readOnly, updateRowMeta]
  );

  const onUploadFile = useCallback(
    async (file: File) => {
      if (!uploadFile) return Promise.reject();
      return uploadFile(file);
    },
    [uploadFile]
  );

  const isFlag = useMemo(() => {
    return icon ? isFlagEmoji(icon) : false;
  }, [icon]);

  const renderIcon = (templateIcon = false) => {
    if (!icon) return null;

    return (
      <CustomIconPopover
        tabs={['emoji']}
        defaultActiveTab={'emoji'}
        enable={!readOnly}
        removeIcon={() => {
          void updateRowMeta(RowMetaKey.IconId, '');
        }}
        onSelectIcon={(icon) => {
          void updateRowMeta(RowMetaKey.IconId, icon.value);
        }}
      >
        <div
          className={cn(
            'view-icon relative flex h-fit w-fit items-center justify-center px-1.5 py-2 text-3xl',
            readOnly ? 'cursor-default' : 'cursor-pointer hover:bg-fill-content-hover',
            isFlag && 'icon',
            templateIcon && 'h-[88px] w-[88px] rounded-[6px] p-0 text-[64px] leading-none'
          )}
        >
          {icon}
        </div>
      </CustomIconPopover>
    );
  };

  const toolbarHeight = templateStyle
    ? icon
      ? hasCover
        ? 'h-11'
        : 'h-[200px]'
      : 'h-10'
    : hasCover && icon
    ? 'h-4'
    : 'h-[36px]';

  return (
    <div
      onMouseEnter={() => {
        if (readOnly) return;
        setIsHover(true);
      }}
      onMouseLeave={() => {
        if (readOnly) return;
        setIsHover(false);
      }}
      className={'flex w-full flex-col'}
    >
      <div className={cn('relative flex w-full justify-center', toolbarHeight)}>
        {!readOnly ? (
          <AddIconCover
            iconTabs={['emoji']}
            defaultIconTab={'emoji'}
            visible={isHover}
            hasIcon={!!icon}
            hasCover={hasCover}
            onUpdateIcon={handleUpdateIcon}
            onAddCover={() => {
              updateRowMeta(
                RowMetaKey.CoverId,
                JSON.stringify({
                  cover_type: RowCoverType.AssetCover,
                  data: 1,
                })
              );
            }}
            onUploadFile={onUploadFile}
            contentClassName={templateStyle ? 'px-[60px] max-sm:px-6' : undefined}
          />
        ) : null}
        {templateStyle && icon ? (
          <div className={cn('absolute left-[60px] z-10 max-sm:left-6', hasCover ? 'bottom-0' : 'bottom-10')}>
            {renderIcon(true)}
          </div>
        ) : null}
      </div>
      <div className={cn('flex w-full items-center px-24 max-sm:px-6', templateStyle && 'px-[60px] max-sm:px-6')}>
        <div className={'flex w-full gap-2'}>
          {!templateStyle ? renderIcon() : null}
          <div className={cn('w-full py-2', templateStyle && 'pb-0 pt-2')}>
            <TextareaAutosize
              autoFocus
              aria-label={templateStyle ? 'Template name' : 'Row title'}
              placeholder={'Untitled'}
              value={value}
              data-testid='row-title-input'
              onChange={(e) => {
                if (readOnly) return;

                updateCell(e.target.value);

                setValue(e.target.value);
                onEdited?.(e.target.value);
              }}
              onKeyDown={(e) => {
                if (createHotkey(HOT_KEY_NAME.ESCAPE)(e.nativeEvent)) {
                  return;
                }

                e.stopPropagation();
              }}
              variant={'ghost'}
              readOnly={readOnly}
              className={cn(
                'h-full w-full rounded-none px-0 text-3xl font-semibold',
                templateStyle && 'text-[28px] font-normal leading-[34px]'
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Title;
