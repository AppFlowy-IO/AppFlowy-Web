import DOMPurify from 'dompurify';
import React, { useEffect, useMemo, useState } from 'react';

import { FieldType, useFieldSelector } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { cn } from '@/lib/utils';
import { getIcon } from '@/utils/emoji';

function FieldCustomIcon({
  fieldId,
  className,
  ...props
}: {
  fieldId: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { field } = useFieldSelector(fieldId);
  const [iconContent, setIconContent] = useState<string | undefined>('');
  const iconId = field?.get(YjsDatabaseKey.icon);
  const type = Number(field?.get(YjsDatabaseKey.type)) || FieldType.RichText;

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
    const cleanSvg = DOMPurify.sanitize(
      iconContent.replaceAll('black', 'currentColor').replace('<svg', '<svg width="100%" height="100%"'),
      {
        USE_PROFILES: { svg: true, svgFilters: true },
      }
    );

    return (
      <span
        {...props}
        className={cn(`custom-icon h-5 w-5 p-0.5 text-text-secondary [&_svg]:h-full [&_svg]:w-full`, className)}
        dangerouslySetInnerHTML={{
          __html: cleanSvg,
        }}
      />
    );
  }, [iconContent, className, props]);

  if (icon) return icon;
  const iconClassName = cn('icon h-5 w-5', className);

  return <FieldTypeIcon type={type} className={iconClassName} />;
}

export default FieldCustomIcon;
