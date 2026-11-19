import { ComponentProps } from 'react';

import alignCenter from '@/assets/icons/align_center.svg';
import alignLeft from '@/assets/icons/align_left.svg';
import alignRight from '@/assets/icons/align_right.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import ai from '@/assets/icons/image-block/ai.svg';
import align from '@/assets/icons/image-block/align.svg';
import caption from '@/assets/icons/image-block/caption.svg';
import chevron from '@/assets/icons/image-block/chevron.svg';
import copy from '@/assets/icons/image-block/copy.svg';
import deleteIcon from '@/assets/icons/image-block/delete.svg';
import download from '@/assets/icons/image-block/download.svg';
import duplicate from '@/assets/icons/image-block/duplicate.svg';
import fullscreen from '@/assets/icons/image-block/fullscreen.svg';
import image from '@/assets/icons/image-block/image.svg';
import link from '@/assets/icons/image-block/link.svg';
import more from '@/assets/icons/image-block/more.svg';
import replace from '@/assets/icons/image-block/replace.svg';
import turn from '@/assets/icons/image-block/turn.svg';
import original from '@/assets/icons/pdf/figma/menu/17070af6734764c8b4d6a338c0a1ac03003c4222.svg';
import { Button } from '@/components/ui/button';

const icons = {
  ai,
  align,
  'align-left': alignLeft,
  'align-center': alignCenter,
  'align-right': alignRight,
  caption,
  chevron,
  copy,
  delete: deleteIcon,
  download,
  duplicate,
  fullscreen,
  image,
  link,
  more,
  original,
  replace,
  turn,
};

export type ImageIconName = keyof typeof icons;
export function ImageIcon({ name }: { name: ImageIconName }) {
  const source = `url("${icons[name]}")`;

  return (
    <span
      aria-hidden='true'
      className={`image-block-icon image-block-icon-${name}`}
      style={{ maskImage: source, WebkitMaskImage: source }}
    />
  );
}

export function ImageMenuRow({
  icon,
  submenu,
  checked,
  children,
  ...props
}: ComponentProps<typeof Button> & { icon?: ImageIconName; submenu?: boolean; checked?: boolean }) {
  return (
    <Button
      variant='ghost'
      className='h-8 w-full justify-start rounded-md px-2 py-1.5 text-sm font-normal leading-5'
      aria-pressed={checked}
      {...props}
    >
      {icon && <ImageIcon name={icon} />}
      <span className='flex-1 text-left'>{children}</span>
      {checked && <CheckIcon aria-hidden='true' className='h-5 w-5 shrink-0 text-text-action' />}
      {submenu && <img src={chevron} alt='' className='h-5 w-5 shrink-0' />}
    </Button>
  );
}

export const imageMenuPaper = {
  className: '!rounded-xl !bg-surface-layer-04 !shadow-[0_2px_8px_#0000001f] ring-1 ring-inset ring-border-primary',
};
