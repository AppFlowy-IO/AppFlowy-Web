import { forwardRef, useCallback, useMemo, useState } from 'react';

import {
  FieldVisibility,
  RowMeta,
  useDatabaseContext,
  useFieldsSelector,
  useReadOnly,
  useRowMetaSelector,
} from '@/application/database-yjs';
import { RowCoverType } from '@/application/types';
import ImageRender from '@/components/_shared/image-render/ImageRender';
import { useBoardContext } from '@/components/database/board/BoardProvider';
import CardToolbar from '@/components/database/components/board/card/CardToolbar';
import CardField from '@/components/database/components/field/CardField';
import { cn } from '@/lib/utils';
import { renderColor } from '@/utils/color';
import { coverOffsetToObjectPosition } from '@/utils/cover';
import { Log } from '@/utils/log';

export interface CardProps {
  groupFieldId: string;
  rowId: string;
  className?: string;

  columnId: string;
}

export const CardPrimitive = forwardRef<HTMLDivElement, CardProps>(
  ({ groupFieldId, rowId, className, columnId }, ref) => {
    const fields = useFieldsSelector();
    const meta = useRowMetaSelector(rowId);
    const { selectedCardIds } = useBoardContext();
    const selected = useMemo(() => {
      return selectedCardIds.includes(`${columnId}/${rowId}`);
    }, [selectedCardIds, columnId, rowId]);
    const cover = meta?.cover;
    const showFields = useMemo(
      () =>
        fields.filter((field) => field.fieldId !== groupFieldId && field.visibility !== FieldVisibility.AlwaysHidden),
      [fields, groupFieldId]
    );
    const readOnly = useReadOnly();
    const [hovered, setHovered] = useState(false);

    const { editingCardId, setEditingCardId, setSelectedCardIds } = useBoardContext();

    const dataCardId = `${columnId}/${rowId}`;
    const editing = useMemo(() => {
      return editingCardId === dataCardId;
    }, [dataCardId, editingCardId]);

    const setEditing = useCallback(
      (editing: boolean) => {
        if (editing) {
          setEditingCardId(dataCardId);
          setSelectedCardIds([]);
        } else {
          setEditingCardId(null);
          setSelectedCardIds([dataCardId]);
        }
      },
      [dataCardId, setEditingCardId, setSelectedCardIds]
    );

    const navigateToRow = useDatabaseContext().navigateToRow;

    const renderCoverImage = useCallback((cover: RowMeta['cover']) => {
      if (!cover) return null;

      if (cover.cover_type === RowCoverType.GradientCover || cover.cover_type === RowCoverType.ColorCover) {
        return (
          <div
            style={{
              background: renderColor(cover.data),
            }}
            className={`h-full w-full`}
          />
        );
      }

      let url: string | undefined = cover.data;

      if (cover.cover_type === RowCoverType.AssetCover) {
        url = {
          1: '/covers/m_cover_image_1.png',
          2: '/covers/m_cover_image_2.png',
          3: '/covers/m_cover_image_3.png',
          4: '/covers/m_cover_image_4.png',
          5: '/covers/m_cover_image_5.png',
          6: '/covers/m_cover_image_6.png',
        }[Number(cover.data)];
      }

      if (!url) return null;

      const objectPosition = coverOffsetToObjectPosition(cover.offset);

      return (
        <>
          <ImageRender
            draggable={false}
            src={url}
            alt={''}
            className={'h-full w-full object-cover'}
            style={{
              objectPosition,
            }}
          />
        </>
      );
    }, []);

    const onEdit = useCallback(() => {
      setEditing(true);
    }, [setEditing]);

    return (
      <div
        onClick={(e) => {
          if (editing) return;
          const target = e.target as HTMLElement;

          Log.debug('custom-icon', target);
          if (target.closest('.custom-icon')) {
            e.stopPropagation();
            return;
          }

          navigateToRow?.(rowId);
        }}
        onPointerMove={(e) => {
          if (editing) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onMouseEnter={() => {
          setHovered(true);
        }}
        onMouseLeave={() => {
          setHovered(false);
        }}
        onMouseDown={(e) => {
          if (editing) {
            e.preventDefault();
          }
        }}
        ref={ref}
        data-card-id={dataCardId}
        className={cn(
          'board-card relative flex flex-col overflow-hidden rounded-[6px] text-xs shadow-card',
          navigateToRow && 'cursor-pointer hover:bg-fill-content-hover',
          selected && 'ring-1 ring-border-theme-thick',
          className
        )}
      >
        {cover && <div className={'h-[100px] w-full bg-cover bg-center'}>{renderCoverImage(cover)}</div>}
        <div className={'flex flex-col gap-2 truncate px-3 py-2'}>
          {showFields.map((field, index) => {
            return (
              <CardField
                editing={editing}
                setEditing={setEditing}
                index={index}
                key={field.fieldId}
                rowId={rowId}
                fieldId={field.fieldId}
              />
            );
          })}
        </div>

        {!readOnly && <CardToolbar visible={hovered && !editing} onEdit={onEdit} rowId={rowId} />}
      </div>
    );
  }
);

export default CardPrimitive;
