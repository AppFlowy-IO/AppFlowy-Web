import { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { AlignType } from '@/application/types';
import alignCenter from '@/assets/icons/align_center.svg';
import alignLeft from '@/assets/icons/align_left.svg';
import alignRight from '@/assets/icons/align_right.svg';
import aiIcon from '@/assets/icons/google-drive/ai.svg';
import alignIcon from '@/assets/icons/google-drive/align.svg';
import captionIcon from '@/assets/icons/google-drive/caption.svg';
import checkIcon from '@/assets/icons/google-drive/check.svg';
import chevronIcon from '@/assets/icons/google-drive/chevron.svg';
import commentIcon from '@/assets/icons/google-drive/comment.svg';
import deleteIcon from '@/assets/icons/google-drive/delete.svg';
import duplicateIcon from '@/assets/icons/google-drive/duplicate.svg';
import fullscreenIcon from '@/assets/icons/google-drive/fullscreen.svg';
import linkIcon from '@/assets/icons/google-drive/link.svg';
import moreIcon from '@/assets/icons/google-drive/more.svg';
import openIcon from '@/assets/icons/google-drive/open.svg';
import originalIcon from '@/assets/icons/google-drive/original.svg';
import plusIcon from '@/assets/icons/google-drive/plus.svg';
import reloadIcon from '@/assets/icons/google-drive/reload.svg';
import replaceIcon from '@/assets/icons/google-drive/replace.svg';
import turnIcon from '@/assets/icons/google-drive/turn.svg';
import userIcon from '@/assets/icons/google-drive/user.svg';
import { Button } from '@/components/ui/button';
import './google-drive.scss';

const icons: Record<string, string> = {
  delete: deleteIcon,
  replace: replaceIcon,
  duplicate: duplicateIcon,
  reload: reloadIcon,
  check: checkIcon,
  open: openIcon,
  chevron: chevronIcon,
  ai: aiIcon,
  link: linkIcon,
  caption: captionIcon,
  fullscreen: fullscreenIcon,
  align: alignIcon,
  original: originalIcon,
  turn: turnIcon,
  comment: commentIcon,
  more: moreIcon,
  plus: plusIcon,
  user: userIcon,
};

export function DriveIcon({ name }: { name: string }) {
  const source =
    name === 'align-left'
      ? alignLeft
      : name === 'align-center'
      ? alignCenter
      : name === 'align-right'
      ? alignRight
      : icons[name];

  return (
    <span
      aria-hidden='true'
      data-drive-icon={name}
      className='drive-menu-icon'
      style={{ maskImage: `url(${JSON.stringify(source)})`, WebkitMaskImage: `url(${JSON.stringify(source)})` }}
    />
  );
}

export function DriveMenuRow({
  icon,
  submenu,
  checked,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  icon?: string;
  submenu?: boolean;
  checked?: boolean;
}) {
  return (
    <Button
      variant='ghost'
      role='menuitem'
      className='h-8 w-full justify-start gap-2 rounded-md px-2 py-1.5 text-sm font-normal leading-5'
      {...props}
    >
      {icon && <DriveIcon name={icon} />}
      <span className='flex-1 text-left'>{children}</span>
      {submenu && (
        <span className='text-icon-tertiary'>
          <DriveIcon name='chevron' />
        </span>
      )}
      {checked && (
        <span className='text-primary'>
          <DriveIcon name='check' />
        </span>
      )}
    </Button>
  );
}

export function DriveAlignItems({
  align = AlignType.Left,
  onChange,
}: {
  align?: AlignType;
  onChange: (value: AlignType) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {([AlignType.Left, AlignType.Center, AlignType.Right] as const).map((value) => (
        <DriveMenuRow key={value} icon={`align-${value}`} checked={align === value} onClick={() => onChange(value)}>
          {t(`document.plugins.googleDrive.align${value === 'left' ? 'Left' : value === 'right' ? 'Right' : 'Center'}`)}
        </DriveMenuRow>
      ))}
    </>
  );
}

export const driveMenuPaper = {
  className: '!rounded-xl !bg-surface-layer-04 !shadow-[0_2px_8px_#0000001f] ring-1 ring-inset ring-border-primary',
};
