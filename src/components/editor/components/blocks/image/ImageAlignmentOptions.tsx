import { useTranslation } from 'react-i18next';

import { AlignType } from '@/application/types';

import { ImageMenuRow } from './ImageIcons';

const choices = [
  { value: AlignType.Left, icon: 'align-left', label: 'document.plugins.pdf.alignLeft' },
  { value: AlignType.Center, icon: 'align-center', label: 'document.plugins.pdf.alignCenter' },
  { value: AlignType.Right, icon: 'align-right', label: 'document.plugins.pdf.alignRight' },
] as const;

export function ImageAlignmentOptions({
  align = AlignType.Left,
  onChange,
}: {
  align?: AlignType;
  onChange: (align: AlignType) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {choices.map(({ value, icon, label }) => (
        <ImageMenuRow key={value} icon={icon} checked={align === value} onClick={() => onChange(value)}>
          {t(label)}
        </ImageMenuRow>
      ))}
    </>
  );
}
