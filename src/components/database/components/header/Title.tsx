import { useCallback, useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';

import { RowMetaKey, useDatabaseContext, useReadOnly } from '@/application/database-yjs';
import { useUpdateCellDispatch, useUpdateRowMetaDispatch } from '@/application/database-yjs/dispatch';
import type { RichTextDelta } from '@/application/database-yjs/fields/text/rich-text';
import { notifyRichTextNewer } from '@/application/database-yjs/fields/text/rich-text-notice';
import { RowCoverType, ViewIconType } from '@/application/types';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { RichTextCellEditor } from '@/components/database/components/cell/text/rich-text/load';
import RichTextCellContent from '@/components/database/components/cell/text/rich-text/RichTextCellContent';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import AddIconCover from '@/components/view-meta/AddIconCover';
import { cn } from '@/lib/utils';
import { isFlagEmoji } from '@/utils/emoji';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

export function Title({
  icon,
  name,
  richText,
  richTextReadOnly = false,
  rowId,
  fieldId,
  hasCover,
  onEdited,
  templateStyle = false,
}: {
  rowId: string;
  icon?: string;
  name?: string;
  /** The title's formatting, when it still describes `name`. */
  richText?: RichTextDelta;
  /** The title was formatted by a newer version of AppFlowy: shown, never edited. */
  richTextReadOnly?: boolean;
  hasCover: boolean;
  fieldId: string;
  onEdited?: (value: string) => void;
  templateStyle?: boolean;
}) {
  const readOnly = useReadOnly();
  const { t } = useTranslation();
  const value = name || '';
  const updateCell = useUpdateCellDispatch(rowId, fieldId);

  const { uploadFile, workspaceId } = useDatabaseContext();

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

  const titleClassName = cn(
    'h-full w-full rounded-none px-0 text-3xl font-semibold',
    templateStyle && 'text-[28px] font-normal leading-[34px]'
  );

  const renderPlainTextEditor = ({ ariaLabel, autoFocus }: { ariaLabel: string; autoFocus: boolean }) => (
    <TextareaAutosize
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      placeholder={'Untitled'}
      value={value}
      data-testid='row-title-input'
      onChange={(e) => {
        void updateCell(e.target.value);
        onEdited?.(e.target.value);
      }}
      onKeyDown={(e) => {
        if (createHotkey(HOT_KEY_NAME.ESCAPE)(e.nativeEvent)) return;
        e.stopPropagation();
      }}
      variant={'ghost'}
      className={titleClassName}
    />
  );

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
            contentClassName={templateStyle ? 'px-[60px] max-sm:px-6' : 'px-[var(--row-page-inset,96px)] max-sm:px-6'}
          />
        ) : null}
        {templateStyle && icon ? (
          <div className={cn('absolute left-[60px] z-10 max-sm:left-6', hasCover ? 'bottom-0' : 'bottom-10')}>
            {renderIcon(true)}
          </div>
        ) : null}
      </div>
      <div
        className={cn(
          'flex w-full items-center px-[var(--row-page-inset,96px)] max-sm:px-6',
          templateStyle && 'px-[60px] max-sm:px-6'
        )}
      >
        <div className={'flex w-full gap-2'}>
          {!templateStyle ? renderIcon() : null}
          <div className={cn('w-full py-2', templateStyle && 'pb-0 pt-2')}>
            {templateStyle && !readOnly && !richTextReadOnly ? (
              // Row templates store plain values, so the template title is
              // edited as plain text (formatting there would be dropped when
              // the template is applied).
              renderPlainTextEditor({ ariaLabel: 'Template name', autoFocus: true })
            ) : readOnly || richTextReadOnly ? (
              <>
                {/* The page's heading, named by its own text (as a document's
                    title is). A role rather than an <h1>: formatted titles
                    render block elements inside it. */}
                <div
                  data-testid='row-title-input'
                  role={'heading'}
                  aria-level={1}
                  className={titleClassName}
                  // A title formatted by a newer version is never edited: a
                  // click shows the update notice (rich text spec R53).
                  onClick={!readOnly && richTextReadOnly ? notifyRichTextNewer : undefined}
                >
                  {richText ? (
                    <RichTextCellContent rowId={rowId} delta={richText} text={value} wrap />
                  ) : (
                    value || <span className={'text-text-tertiary'}>{'Untitled'}</span>
                  )}
                </div>
                {!readOnly && richTextReadOnly ? (
                  <div data-testid='row-title-read-only-hint' className={'text-xs text-text-tertiary'}>
                    {t('grid.row.richTextRequiresNewerVersion')}
                  </div>
                ) : null}
              </>
            ) : (
              <ErrorBoundary
                key={JSON.stringify([workspaceId, rowId, fieldId])}
                fallback={renderPlainTextEditor({ ariaLabel: 'Row title', autoFocus: false })}
              >
                <RichTextCellEditor
                  variant={'title'}
                  testId={'row-title-input'}
                  ariaLabel={templateStyle ? 'Template name' : 'Row title'}
                  rowId={rowId}
                  fieldId={fieldId}
                  value={value}
                  richText={richText}
                  placeholder={'Untitled'}
                  className={titleClassName}
                  onSaved={onEdited}
                />
              </ErrorBoundary>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Title;
