import { Suspense, useCallback, useMemo, useRef } from 'react';

import { FieldType } from '@/application/database-yjs';
import { Cell, CellProps, TextCell as TextCellType } from '@/application/database-yjs/cell.type';
import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { YjsDatabaseKey } from '@/application/types';
import { usePlainTextCellEditing } from '@/components/database/components/cell/text/PlainTextCellEditing';
import { RichTextCellContent, RichTextCellEditor } from '@/components/database/components/cell/text/rich-text/load';
import TextCellEditing from '@/components/database/components/cell/text/TextCellEditing';
import UrlActions from '@/components/database/components/cell/text/UrlActions';
import { cn } from '@/lib/utils';
import { openUrl, processUrl } from '@/utils/url';

export function TextCell({
  cell,
  style,
  placeholder,
  readOnly,
  fieldId,
  rowId,
  editing,
  setEditing,
  wrap,
  isHovering,
}: CellProps<Cell>) {
  const ref = useRef<HTMLDivElement>(null);
  const { field } = useFieldSelector(fieldId);
  const templateEditingRowId = useDatabaseContextOptional()?.templateEditingRowId;
  // The field decides, not the cell: an empty URL cell has no cell yet.
  const fieldType = field ? (Number(field.get(YjsDatabaseKey.type)) as FieldType) : undefined;
  const cellType = fieldType ?? cell?.fieldType ?? FieldType.RichText;
  // Text fields, including the primary (title) field, are rich; URL cells
  // share this component but stay plain. So does a row template's source
  // row: templates store plain values, so formatting typed there would be
  // dropped when the template is applied.
  const isRichText = cellType === FieldType.RichText && templateEditingRowId !== rowId;
  const richText = isRichText ? (cell as TextCellType | undefined)?.richText : undefined;
  const editsAsPlainText = usePlainTextCellEditing();

  const middleware = useCallback((data: unknown) => {
    if (typeof data !== 'string' && typeof data !== 'number') {
      return '';
    }

    return (data as string) || '';
  }, []);

  const value = middleware(cell?.data);

  const isValidUrl = useCallback((url: string) => {
    return !!processUrl(url);
  }, []);

  const showUrlActions = useMemo(() => {
    return cellType === FieldType.URL && value && isValidUrl(value) && !editing && isHovering;
  }, [value, isValidUrl, editing, isHovering, cellType]);

  const focusToEnd = useCallback((el: HTMLTextAreaElement) => {
    if (el) {
      const length = el.value.length;

      el.setSelectionRange(length, length);
      el.focus();
    }
  }, []);

  return (
    <>
      <div
        ref={ref}
        style={style}
        onClick={(e) => {
          if (readOnly) {
            // Formatted text opens its own links and chips.
            if (!richText && value && isValidUrl(value)) {
              e.stopPropagation();
              void openUrl(value, '_blank');
            }

            return;
          }
        }}
        className={cn(
          `text-cell w-full text-sm ${readOnly ? 'select-auto' : 'cursor-pointer'}`,
          !value && placeholder ? 'text-text-tertiary' : '',
          // A link only once there is one: the placeholder stays a hint.
          cellType === FieldType.URL && value ? '!text-text-action underline hover:text-text-action-hover' : '',
          wrap ? ' whitespace-pre-wrap break-words' : 'whitespace-nowrap'
        )}
      >
        {!editing ? (
          richText ? (
            <Suspense fallback={value}>
              <RichTextCellContent rowId={rowId} delta={richText} text={value} wrap={wrap} />
            </Suspense>
          ) : (
            <>{value || placeholder || ''}</>
          )
        ) : isRichText && !editsAsPlainText ? (
          <Suspense fallback={value}>
            <RichTextCellEditor
              value={value}
              richText={richText}
              placeholder={placeholder}
              // The property's name, or the hint where there is none to show.
              ariaLabel={(field?.get(YjsDatabaseKey.name) as string | undefined) || placeholder}
              fieldId={fieldId}
              rowId={rowId}
              onExit={() => {
                setEditing?.(false);
              }}
            />
          </Suspense>
        ) : (
          <TextCellEditing
            ref={focusToEnd}
            defaultValue={value}
            placeholder={placeholder}
            fieldId={fieldId}
            rowId={rowId}
            onExit={() => {
              setEditing?.(false);
            }}
          />
        )}
        {showUrlActions && (
          <div className={'absolute right-1 top-1'}>
            <UrlActions url={value} />
          </div>
        )}
      </div>
    </>
  );
}
