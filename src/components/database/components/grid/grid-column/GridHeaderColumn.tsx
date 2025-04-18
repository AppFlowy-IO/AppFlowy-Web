import { Column, FieldType, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import { FieldTypeIcon } from '@/components/database/components/field';
import { getIcon } from '@/utils/emoji';
import DOMPurify from 'dompurify';
import React, { useEffect, useMemo, useState } from 'react';
import { ReactComponent as AIIndicatorSvg } from '@/assets/icons/ai_indicator.svg';
import { ResizeHandle } from './ResizeHandle';

export function GridHeaderColumn ({ column, onResizeColumnStart }: {
  column: Column;
  onResizeColumnStart?: (fieldId: string, element: HTMLElement) => void;
}) {
  const readOnly = useReadOnly();
  const [iconContent, setIconContent] = useState<string | undefined>('');
  const { field } = useFieldSelector(column.fieldId);
  const iconId = field?.get(YjsDatabaseKey.icon);
  const name = field?.get(YjsDatabaseKey.name);
  const type = useMemo(() => {
    const type = field?.get(YjsDatabaseKey.type);

    if (!type) return FieldType.RichText;

    return parseInt(type) as FieldType;
  }, [field]);

  useEffect(() => {
    if (iconId) {
      try {
        void getIcon(iconId).then((item) => {
          setIconContent(item?.content?.replace('<svg', '<svg width="100%" height="100%"'));
        });
      } catch (e) {
        console.error(e, iconId);
      }
    } else {
      setIconContent('');
    }
  }, [iconId]);

  const icon = useMemo(() => {
    if (!iconContent) return null;
    const cleanSvg = DOMPurify.sanitize(iconContent, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });

    return <span
      className={`h-5 w-5`}
      dangerouslySetInnerHTML={{
        __html: cleanSvg,
      }}
    />;
  }, [iconContent]);
  const isAIField = [FieldType.AISummaries, FieldType.AITranslations].includes(type);

  return (
    <div
      style={{
        cursor: readOnly ? 'default' : 'pointer',
      }}
      className={'rounded-none text-text-secondary hover:bg-fill-content-hover relative text-sm flex items-center px-2 h-full gap-[6px] w-full justify-start'}
    >
      {icon || <FieldTypeIcon
        type={type}
        className={'icon mr-1 h-4 w-4'}
      />}
      <div className={'flex-1 truncate'}>{name}</div>
      {isAIField && <AIIndicatorSvg className={'h-5 w-5 text-xl'} />}
      {onResizeColumnStart && !readOnly && <ResizeHandle
        fieldId={column.fieldId}
        onResizeStart={onResizeColumnStart}
      />}

    </div>
  );
}

export default GridHeaderColumn;