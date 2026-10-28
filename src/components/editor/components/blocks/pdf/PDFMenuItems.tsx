import { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AlignType } from '@/application/types';
import { ReactComponent as AskIcon } from '@/assets/icons/math-equation/ask.svg';
import { ReactComponent as AIIcon } from '@/assets/icons/math-equation/menu-ai.svg';
import ai from '@/assets/icons/pdf/figma/c8820f3e085c9068a603ed514a8abbbcc74038ad.svg';
import download from '@/assets/icons/pdf/figma/menu/0256ec0173391afc735c3fd2e53618c45dfec02b.svg';
import deleteIcon from '@/assets/icons/pdf/figma/menu/149e9d068caedcc28ddff940d5a9fb954a074197.svg';
import original from '@/assets/icons/pdf/figma/menu/17070af6734764c8b4d6a338c0a1ac03003c4222.svg';
import open from '@/assets/icons/pdf/figma/menu/1817cb40c78df5fb25fffa75851c72fb40f9f532.svg';
import replace from '@/assets/icons/pdf/figma/menu/199ea515bf591d85d5cd36ca53df91322933d06b.svg';
import fullscreen from '@/assets/icons/pdf/figma/menu/19d4243d97e533b47515c1a5abb2be0b99e7745a.svg';
import chevron from '@/assets/icons/pdf/figma/menu/1af107cda2c773bb4b1875e5f216d2aa830c510a.svg';
import turn from '@/assets/icons/pdf/figma/menu/3c0e2154055d3f07e9e3615a0e3e609b75fc7823.svg';
import align from '@/assets/icons/pdf/figma/menu/9744aaa5e1f432f11e169df5b3c622da6fb841e0.svg';
import link from '@/assets/icons/pdf/figma/menu/a37e48df3cd52336ec4f023c7da210de3ef245f6.svg';
import caption from '@/assets/icons/pdf/figma/menu/a80489ba727f096eb11114ac2d3cd06eed364386.svg';
import duplicate from '@/assets/icons/pdf/figma/menu/dee45f3cd60ade8c3bd1f898ea37cdf7bee690a7.svg';
import { ReactComponent as SummarizeIcon } from '@/assets/icons/summarize.svg';
import { Button } from '@/components/ui/button';
import './pdf.scss';

export const pdfIcons = {
  ai,
  align,
  caption,
  chevron,
  delete: deleteIcon,
  download,
  duplicate,
  fullscreen,
  link,
  open,
  original,
  replace,
  turn,
};
// Keep the Figma shapes while letting the menu's semantic color paint them.
const iconMasks = Object.fromEntries(
  Object.values(pdfIcons).map((source) => {
    const image = `url(${JSON.stringify(source)})`;

    return [source, { maskImage: image, WebkitMaskImage: image }];
  })
);

export const pdfMenuPaper = {
  className: '!rounded-xl !bg-surface-layer-04 !shadow-[0_2px_8px_#0000001f] ring-1 ring-inset ring-border-primary',
};

export function PDFMenuRow({
  icon,
  submenu,
  children,
  ...props
}: ComponentProps<typeof Button> & { icon?: ReactNode; submenu?: boolean }) {
  return (
    <Button
      variant='ghost'
      className='h-8 w-full justify-start rounded-md px-2 py-1.5 text-sm font-normal leading-5'
      {...props}
    >
      {typeof icon === 'string'
        ? <span aria-hidden='true' className='pdf-menu-icon' style={iconMasks[icon]} />
        : icon && <span aria-hidden='true' className='flex h-5 w-5 shrink-0 items-center justify-center'>{icon}</span>}
      <span className='flex-1 text-left'>{children}</span>
      {submenu && <img src={chevron} alt='' />}
    </Button>
  );
}

export function PDFMenuAIIcon() {
  return (
    <span className='relative h-5 w-5'>
      <AIIcon width={15.0013} height={16} className='absolute left-[3px] top-0.5 [&_path[fill]]:fill-current [&_path[stroke]]:stroke-current' />
    </span>
  );
}

export function PDFAlignmentItems({ onAlign }: { onAlign: (align: AlignType) => void }) {
  const { t } = useTranslation();

  return (
    <>
      {([AlignType.Left, AlignType.Center, AlignType.Right] as const).map((align) => (
        <PDFMenuRow key={align} onClick={() => onAlign(align)}>
          {t(
            align === AlignType.Left
              ? 'document.plugins.pdf.alignLeft'
              : align === AlignType.Right
              ? 'document.plugins.pdf.alignRight'
              : 'document.plugins.pdf.alignCenter'
          )}
        </PDFMenuRow>
      ))}
    </>
  );
}

export type PDFAIMode = 'summary' | 'ask';
export function PDFAIMenuItems({
  onAction,
  canSummarize = true,
}: {
  onAction: (mode: PDFAIMode) => void;
  canSummarize?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
      <PDFMenuRow icon={<SummarizeIcon width={20} height={20} />} disabled={!canSummarize} onClick={() => onAction('summary')}>
        {t('document.plugins.pdf.summarizePDF')}
      </PDFMenuRow>
      <PDFMenuRow icon={<AskIcon width={20} height={20} />} onClick={() => onAction('ask')}>{t('document.plugins.pdf.askAI')}</PDFMenuRow>
    </>
  );
}
