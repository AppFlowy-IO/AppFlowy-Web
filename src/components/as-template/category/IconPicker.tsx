import { IconButton, InputLabel } from '@mui/material';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import { TemplateIcon } from '@/application/template.type';
import { CategoryIcon } from '@/components/as-template/icons';

const options = Object.values(TemplateIcon);

const IconPicker = forwardRef<
  HTMLDivElement,
  {
    value: string;
    onChange: (value: string) => void;
  }
>(({ value, onChange }, ref) => {
  const { t } = useTranslation();

  return (
    <div ref={ref} className={'flex flex-col gap-2'}>
      <InputLabel>{t('template.category.icons')}</InputLabel>
      <div className={'flex flex-wrap gap-2'}>
        {options.map((icon) => {
          return (
            <IconButton
              className={`flex h-10 w-10 items-center justify-center p-2`}
              style={{
                backgroundColor: value === icon ? 'var(--fill-content-hover)' : undefined,
              }}
              key={icon}
              onClick={() => onChange(icon)}
            >
              <CategoryIcon icon={icon} />
            </IconButton>
          );
        })}
      </div>
    </div>
  );
});

export default IconPicker;
