import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as PreviewIcon } from '@/assets/icons/show.svg';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { Banner, getAssetBannerSrc } from './banner';
import { isInlineAvatar } from './ProfileAvatar';
import { renderProfileMarkdown } from './profileMarkdown';
import { useAuthenticatedImage } from './useAuthenticatedImage';

function PreviewBanner({ banner }: { banner: Banner }) {
  const networkSrc = useAuthenticatedImage(banner.kind === 'network' ? banner.url : undefined);

  if (banner.kind === 'color') {
    return <div className='h-20 w-full rounded-300' style={{ backgroundColor: banner.color }} />;
  }

  return (
    <img
      src={banner.kind === 'asset' ? getAssetBannerSrc(banner.path) : networkSrc}
      alt=''
      draggable={false}
      className='h-20 w-full rounded-300 object-cover'
    />
  );
}

/**
 * The "Preview" popover: a read-only rendering of how this member's profile card
 * appears elsewhere in the app (mentions, comments).
 */
export function ProfilePreview({
  name,
  email,
  avatar,
  aboutMe,
  banner,
  role,
}: {
  name: string;
  email: string;
  avatar: string;
  aboutMe: string;
  banner: Banner;
  role?: string;
}) {
  const { t } = useTranslation();
  const inline = isInlineAvatar(avatar);
  const renderedAboutMe = useMemo(() => (aboutMe ? renderProfileMarkdown(aboutMe) : null), [aboutMe]);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant='ghost' size='default' data-testid='profile-preview-button' className='gap-[6px]'>
              <PreviewIcon className='h-5 w-5' />
              {t('settings.profilePage.preview')}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side='bottom'>{t('settings.profilePage.previewButtonTooltip')}</TooltipContent>
      </Tooltip>

      <PopoverContent align='end' className='w-[280px] p-0' data-testid='profile-preview-card'>
        <div className='p-2'>
          <PreviewBanner banner={banner} />
        </div>

        <div className='-mt-10 px-5 pb-5'>
          <Avatar size='xl' className='h-[90px] w-[90px] border-[5px] border-surface-layer-01'>
            <AvatarImage src={inline ? '' : avatar} alt={name} />
            <AvatarFallback name={name}>
              {inline ? <span className='text-3xl'>{avatar}</span> : (name || '?').charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className='mt-3 truncate text-xl font-semibold text-text-primary'>{name}</div>
          <div className='truncate text-sm text-text-secondary'>{email}</div>

          {renderedAboutMe ? (
            <div className='appflowy-scroller mt-2 max-h-24 overflow-y-auto rounded-300 bg-fill-content-visible px-3 py-3 text-xs text-text-primary'>
              {renderedAboutMe}
            </div>
          ) : null}

          {role && (
            <div className='mt-5'>
              <span className='rounded-200 bg-fill-content px-2 py-1 text-xs text-text-secondary'>{role}</span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default ProfilePreview;
