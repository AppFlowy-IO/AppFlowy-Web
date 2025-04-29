import { RowMetaKey, useDatabaseContext, useRowMetaSelector } from '@/application/database-yjs';
import { CellProps, TextCell as CellType } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch, useUpdateRowMetaDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as DocumentSvg } from '@/assets/icons/doc.svg';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { TextCell } from '@/components/database/components/cell/text';
import { Button } from '@/components/ui/button';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { getPlatform } from '@/utils/platform';
import React, { useCallback, useMemo } from 'react';

export function PrimaryCell (
  props: CellProps<CellType> & {
    showDocumentIcon?: boolean;
    setEditing?: (editing: boolean) => void;
    editing?: boolean
  },
) {
  const { placeholder, rowId, showDocumentIcon, editing, setEditing, cell, fieldId, readOnly } = props;
  const meta = useRowMetaSelector(rowId);
  const navigateToRow = useDatabaseContext().navigateToRow;
  const hasDocument = meta?.isEmptyDocument === false;
  const icon = meta?.icon;

  const isMobile = useMemo(() => {
    return getPlatform()?.isMobile;
  }, []);
  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);
  const onUpdateMeta = useUpdateRowMetaDispatch(rowId);

  const [inputValue, setInputValue] = React.useState<string>(() => {
    if (cell) {
      return cell.data;
    }

    return '';
  });

  const showIcon = icon || (hasDocument && showDocumentIcon);

  const focusToEnd = useCallback((el: HTMLTextAreaElement) => {
    if (el) {
      const length = el.value.length;

      el.setSelectionRange(length, length);
      el.focus();
    }
  }, []);

  return (
    <div
      onClick={() => {
        if (isMobile) {
          navigateToRow?.(rowId);
        }
      }}
      className={'primary-cell relative flex h-full w-full gap-2'}
    >
      <CustomIconPopover
        defaultActiveTab={'emoji'}
        tabs={['emoji']}
        onSelectIcon={(icon) => {
          onUpdateMeta(RowMetaKey.IconId, icon.value);
        }}
        removeIcon={() => {
          onUpdateMeta(RowMetaKey.IconId, undefined);
        }}
        enable={Boolean(!readOnly && icon)}
      >
        {showIcon ?
          <Button
            className={'p-0 h-5 w-5 disabled:text-icon-primary rounded-100'}
            variant={'ghost'}
            disabled={readOnly}
            onClick={e => {
              if (readOnly) return;
              e.stopPropagation();
            }}
          >
            {icon ? (
              <div className={'flex h-5 w-5 items-center justify-center text-base'}>{icon}</div>
            ) : (
              <DocumentSvg className={'h-5 w-5'} />
            )}
          </Button>
          : null
        }

      </CustomIconPopover>

      <div
        className={'flex-1 flex items-center overflow-x-hidden'}
      >
        {
          editing ? <TextareaAutosize
            onMouseDown={e => {
              e.stopPropagation();
            }}
            autoFocus
            ref={focusToEnd}
            value={inputValue}
            onChange={e => {
              setInputValue(e.target.value);
            }}
            onKeyDown={e => {
              if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
                onUpdateCell(inputValue);
                setEditing?.(false);
              }
            }}
            onBlur={() => {
              onUpdateCell(inputValue);
              setEditing?.(false);
            }}
            placeholder={placeholder}
            variant={'ghost'}
            size={'sm'}
            className={'w-full px-0'}
          /> : <TextCell {...props} />
        }

      </div>
    </div>
  );
}

export default PrimaryCell;
