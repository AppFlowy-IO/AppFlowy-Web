import {
  RowMeta,
  useDatabaseContext,
  useFieldsSelector,
  useRowMetaSelector,
} from '@/application/database-yjs';
import CardField from '@/components/database/components/field/CardField';
import { cn } from '@/lib/utils';
import React, { forwardRef, useCallback, useMemo } from 'react';
import { RowCoverType } from '@/application/types';
import { renderColor } from '@/utils/color';
import ImageRender from '@/components/_shared/image-render/ImageRender';

export interface CardProps {
  groupFieldId: string;
  rowId: string;
  className?: string;
}

export const CardPrimitive = forwardRef<HTMLDivElement, CardProps>(({ groupFieldId, rowId, className }, ref) => {
  const fields = useFieldsSelector();
  const meta = useRowMetaSelector(rowId);
  const cover = meta?.cover;
  const showFields = useMemo(() => fields.filter((field) => field.fieldId !== groupFieldId), [fields, groupFieldId]);

  const navigateToRow = useDatabaseContext().navigateToRow;

  const renderCoverImage = useCallback((cover: RowMeta['cover']) => {
    if (!cover) return null;

    if (cover.cover_type === RowCoverType.GradientCover || cover.cover_type === RowCoverType.ColorCover) {
      return <div
        style={{
          background: renderColor(cover.data),
        }}
        className={`h-full w-full`}
      />;
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

    return (
      <>
        <ImageRender
          draggable={false}
          src={url}
          alt={''}
          className={'h-full w-full object-cover'}
        />
      </>
    );
  }, []);

  return (
    <div
      onClick={() => {
        navigateToRow?.(rowId);
      }}
      ref={ref}
      className={cn(
        'relative board-card shadow-card flex flex-col gap-2 overflow-hidden rounded-[6px] text-xs',
        navigateToRow && 'cursor-pointer hover:bg-fill-primary-alpha-5',
        className,
      )}
    >
      {cover && (
        <div
          className={'w-full h-[100px] bg-cover bg-center'}
        >
          {renderCoverImage(cover)}
        </div>
      )}
      <div className={'flex flex-col py-2 px-3'}>
        {showFields.map((field, index) => {
          return <CardField
            index={index}
            key={field.fieldId}
            rowId={rowId}
            fieldId={field.fieldId}
          />;

        })}
      </div>

    </div>
  );
});

export default CardPrimitive;
